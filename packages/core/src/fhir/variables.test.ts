import { describe, expect, it } from 'vitest';
import { stubModel } from '../../test/support/stub-model.ts';
import {
  type CompileOptions,
  type EvaluateOptions,
  evaluate,
  evaluateAsync,
} from '../api/compile.ts';
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { ModelNode } from '../model/model-node.ts';
import type { Collection } from '../runtime/collection.ts';
import { navigateMember, toInputCollection } from '../runtime/navigation.ts';
import {
  containerOf,
  createFhirEnvironment,
  enclosingResource,
  fhirConstant,
  resourceOf,
  rootResourceOf,
} from './variables.ts';

// Synthetic data.
const patient = {
  resourceType: 'Patient',
  id: 'p1',
  name: [{ given: ['Ada'] }],
  contained: [
    { resourceType: 'Organization', id: 'o1', name: 'Acme' },
    { resourceType: 'Patient', id: 'p2', name: [{ given: ['Mina'] }] },
  ],
};

const bundle = {
  resourceType: 'Bundle',
  entry: [{ fullUrl: 'urn:uuid:1', resource: patient }],
};

const WITH_AND_WITHOUT_MODEL: readonly CompileOptions[] = [{}, { model: stubModel }];

function run(
  input: unknown,
  expression: string,
  options: CompileOptions & EvaluateOptions = {},
): unknown[] {
  return evaluate(input, expression, options);
}

function nodes(collection: Collection): ModelNode[] {
  return collection.filter((item): item is ModelNode => item instanceof ModelNode);
}

function path(input: unknown, names: readonly string[]): ModelNode {
  let current: Collection = toInputCollection(input, '', stubModel);
  for (const name of names) {
    current = navigateMember(current, name, { model: stubModel, lenientChoiceSuffix: false });
  }
  const [node] = nodes(current);
  if (node === undefined) throw new Error(`no node at ${names.join('.')}`);
  return node;
}

// https://hl7.org/fhir/R5/fhirpath.html#vars
describe('the FHIR URL constants', () => {
  it.each<[string, string]>([
    ['sct', 'http://snomed.info/sct'],
    ['loinc', 'http://loinc.org'],
    ['vs-administrative-gender', 'http://hl7.org/fhir/ValueSet/administrative-gender'],
    ['ext-patient-birthTime', 'http://hl7.org/fhir/StructureDefinition/patient-birthTime'],
  ])('%%%s', (name, url) => {
    expect(fhirConstant(name)).toEqual([url]);
  });

  it.each(['vs-', 'ext-', 'SCT', 'resource', 'us-zip', 'constructor'])(
    'does not define %s',
    (name) => {
      expect(fhirConstant(name)).toBeUndefined();
    },
  );

  // testVariables1–4
  it.each<[string, unknown[]]>([
    ["%sct = 'http://snomed.info/sct'", [true]],
    ["%loinc = 'http://loinc.org'", [true]],
    ["%`vs-administrative-gender` = 'http://hl7.org/fhir/ValueSet/administrative-gender'", [true]],
    ['%`ext-patient-birthTime`', ['http://hl7.org/fhir/StructureDefinition/patient-birthTime']],
  ])('evaluates %s', (expression, expected) => {
    expect(run(patient, expression)).toEqual(expected);
  });

  it('raises eval/undefined-variable for a prefix without a name', () => {
    expect(() => run(null, '%`vs-`')).toThrow(
      expect.objectContaining({ code: 'eval/undefined-variable' }),
    );
  });

  it('gives way to a host variable of the same name', () => {
    expect(run(null, '%sct', { variables: { sct: 'other' } })).toEqual(['other']);
    expect(run(null, '%loinc', { variables: { sct: 'other' } })).toEqual(['http://loinc.org']);
  });
});

// https://hl7.org/fhir/R5/fhirpath.html#variables
describe('resources along the parent chain', () => {
  it('finds the resource a node is part of', () => {
    const given = path(patient, ['name', 'given']);
    expect(enclosingResource(given)?.value).toBe(patient);
    const organization = path(patient, ['contained', 'name']);
    expect(enclosingResource(organization)?.value).toBe(patient.contained[0]);
    expect(enclosingResource(new ModelNode({ value: { a: 1 }, name: 'x' }))).toBeUndefined();
  });

  it('steps from a contained resource to its container, but never into a Bundle', () => {
    const contained = path(patient, ['contained']);
    expect(containerOf(contained).value).toBe(patient);
    const root = path(patient, []);
    expect(containerOf(root)).toBe(root);
    const inBundle = path(bundle, ['entry', 'resource']);
    expect(containerOf(inBundle)).toBe(inBundle);
    const containedInBundle = path(bundle, ['entry', 'resource', 'contained']);
    expect(containerOf(containedInBundle).value).toBe(patient);
  });

  it('lists a resource once however many items are part of it', () => {
    const [first, second] = nodes(
      navigateMember(
        navigateMember(toInputCollection(patient, '', stubModel), 'contained', {
          model: stubModel,
          lenientChoiceSuffix: false,
        }),
        'id',
        { model: stubModel, lenientChoiceSuffix: false },
      ),
    );
    if (first === undefined || second === undefined) throw new Error('no ids');
    const resources = nodes(resourceOf([first, second]));
    expect(resources.map((node) => node.value)).toEqual(patient.contained);
    expect(nodes(rootResourceOf(resources)).map((node) => node.value)).toEqual([patient]);
    expect(resourceOf([first, first])).toHaveLength(1);
  });

  it('uses an item that is part of no resource as it is', () => {
    const datatype = new ModelNode({ value: { system: 'x' }, name: 'coding' });
    expect(resourceOf([datatype, 'text'])).toEqual([datatype, 'text']);
    expect(rootResourceOf([datatype])).toEqual([datatype]);
    expect(resourceOf([])).toEqual([]);
  });
});

describe('%resource and %rootResource', () => {
  it('are the input resource by default, with and without a model', () => {
    for (const options of WITH_AND_WITHOUT_MODEL) {
      expect(run(patient, '%resource.id', options)).toEqual(['p1']);
      expect(run(patient, '%rootResource.id', options)).toEqual(['p1']);
      // A data type passed on its own is its own resource.
      expect(run({ given: ['Ada'] }, '%resource.given', options)).toEqual(['Ada']);
    }
  });

  it('follow the parent chain of an input node to the resource and its container', () => {
    for (const options of WITH_AND_WITHOUT_MODEL) {
      const [given] = evaluate(patient, "contained.where(id = 'p2').name.given", {
        ...options,
        output: 'typed',
      });
      expect(run(given, '%resource.id', options)).toEqual(['p2']);
      expect(run(given, '%rootResource.id', options)).toEqual(['p1']);
      expect(run(given, '%context')).toEqual(['Mina']);
    }
  });

  it('stop at a resource in a Bundle entry', () => {
    const [given] = evaluate(bundle, 'Bundle.entry.resource.name.given', {
      model: stubModel,
      output: 'typed',
    });
    expect(run(given, '%resource.id', { model: stubModel })).toEqual(['p1']);
    expect(run(given, '%rootResource.id', { model: stubModel })).toEqual(['p1']);
  });

  it('take the values of the resource and rootResource options', () => {
    const organization = patient.contained[0];
    expect(run(organization, '%resource.id', { resource: patient })).toEqual(['p1']);
    // Without its own value, %rootResource follows the overridden %resource.
    expect(run(organization, '%rootResource.id', { resource: patient })).toEqual(['p1']);
    expect(run(organization, '%rootResource.id', { rootResource: patient })).toEqual(['p1']);
    expect(run(organization, '%resource.id', { rootResource: patient })).toEqual(['o1']);
    // The model types the host's value like the input.
    expect(run(null, '%resource is Patient', { resource: patient, model: stubModel })).toEqual([
      true,
    ]);
  });

  it('are empty when the option is null or an empty array', () => {
    expect(run(patient, '%resource.count()', { resource: null })).toEqual([0]);
    expect(run(patient, '%rootResource.count()', { rootResource: [] })).toEqual([0]);
    expect(run(patient, '%resource.id', { resource: undefined })).toEqual(['p1']);
  });

  it('give way to host variables of the same name, as before they were built in', () => {
    const variables = { resource: { id: 'x' } };
    expect(run(patient, '%resource.id', { variables })).toEqual(['x']);
    // The variable hides %resource only; %rootResource is still derived from the input.
    expect(run(patient, '%rootResource.id', { variables })).toEqual(['p1']);
  });

  it('reject an option value that is not JSON data, even when unused', () => {
    expect(() => run(patient, '1', { resource: () => patient })).toThrow(FhirPathEvaluationError);
    expect(() => run(patient, '1', { rootResource: Symbol('x') })).toThrow(
      expect.objectContaining({ code: 'eval/invalid-argument' }),
    );
  });

  it('give the same values in async evaluations', async () => {
    expect(await evaluateAsync(patient, '%resource.id | %rootResource.id')).toEqual(['p1']);
  });
});

describe('createFhirEnvironment', () => {
  it('computes %resource once per evaluation, on first use', () => {
    const lookUp = createFhirEnvironment(toInputCollection(patient, ''), {}, undefined);
    const resource = lookUp('resource');
    expect(lookUp('resource')).toBe(resource);
    expect(lookUp('rootResource')).toBe(lookUp('rootResource'));
    expect(lookUp('missing')).toBeUndefined();
  });
});
