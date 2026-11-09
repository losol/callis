import { describe, expect, it } from 'vitest';
import { stubModel } from '../../test/support/stub-model.ts';
import {
  type CompileOptions,
  type EvaluateOptions,
  evaluate,
  evaluateAsync,
} from '../api/compile.ts';
import { ModelNode } from '../model/model-node.ts';

// Synthetic data.
const organization = { resourceType: 'Organization', id: 'o1', name: 'Acme' };
const patient = {
  resourceType: 'Patient',
  id: 'p1',
  contained: [
    organization,
    { resourceType: 'Patient', id: 'p2', managingOrganization: { reference: '#o1' } },
    { resourceType: 'Observation', id: 'self', subject: { reference: '#' } },
  ],
  managingOrganization: { reference: '#o1', display: 'Acme' },
};

const observation = (id: string, subject: string, extra: object = {}) => ({
  resourceType: 'Observation',
  id,
  subject: { reference: subject },
  ...extra,
});

const bundle = {
  resourceType: 'Bundle',
  entry: [
    { fullUrl: 'http://example.org/fhir/Patient/p1', resource: patient },
    { fullUrl: 'urn:uuid:5c4b', resource: observation('o1', 'Patient/p1') },
    { fullUrl: 'urn:uuid:9f2e', resource: observation('o2', 'urn:uuid:5c4b') },
    {
      fullUrl: 'urn:uuid:aa01',
      resource: {
        resourceType: 'Patient',
        id: 'p3',
        meta: { versionId: '2' },
        contained: [{ resourceType: 'Organization', id: 'o1', name: 'Other' }],
        managingOrganization: { reference: '#o1' },
      },
    },
    { fullUrl: 'urn:uuid:b4', resource: observation('o3', 'http://example.org/fhir/Patient/p1') },
    { fullUrl: 'urn:uuid:c5', resource: observation('o4', 'Patient/p3/_history/2') },
    { fullUrl: 'urn:uuid:d6', resource: observation('o5', 'Patient/p3/_history/1') },
    { fullUrl: 'urn:uuid:e7', resource: observation('o6', 'Patient/missing') },
    { fullUrl: 'urn:uuid:f8', resource: observation('o7', 'https://elsewhere.example/Patient/p1') },
  ],
};

function run(
  input: unknown,
  expression: string,
  options: CompileOptions & EvaluateOptions = {},
): unknown[] {
  return evaluate(input, expression, options);
}

const MODELS: ReadonlyArray<readonly [string, CompileOptions]> = [
  ['without a model', {}],
  ['with a model', { model: stubModel }],
];

// https://hl7.org/fhir/R5/fhirpath.html#functions, docs/spec-notes.md#local-references-in-resolve
describe.each(MODELS)('resolve() %s', (_label, options) => {
  it('finds a contained resource of the root resource', () => {
    expect(run(patient, 'Patient.managingOrganization.resolve().name', options)).toEqual(['Acme']);
    expect(run(patient, "'#o1'.resolve().name", options)).toEqual(['Acme']);
    expect(run(patient, "'#o1'.resolve().id", options)).toEqual(['o1']);
  });

  it('resolves a reference inside a contained resource against its container', () => {
    expect(run(patient, 'Patient.contained.managingOrganization.resolve().name', options)).toEqual([
      'Acme',
    ]);
  });

  it('resolves # to the root resource', () => {
    expect(run(patient, "'#'.resolve().id", options)).toEqual(['p1']);
  });

  it('gives the node navigation gives, with its parent chain', () => {
    const [resolved] = run(patient, "'#o1'.resolve()", { ...options, output: 'typed' });
    const [navigated] = run(patient, "Patient.contained.where(id = 'o1')", {
      ...options,
      output: 'typed',
    });
    expect(resolved).toBeInstanceOf(ModelNode);
    expect(resolved).toEqual(navigated);
    expect((resolved as ModelNode).parent?.value).toBe(patient);
  });

  it('looks up references in the Bundle around them, by fullUrl or type and id', () => {
    expect(run(bundle, 'Bundle.entry.resource.subject.resolve().id', options)).toEqual([
      'p1', // Patient/p1: type and id
      'o1', // urn:uuid:5c4b: fullUrl
      'p1', // the absolute fullUrl
      'p3', // a version that matches meta.versionId
    ]);
  });

  it('resolves contained references in a Bundle entry against that entry', () => {
    expect(
      run(bundle, 'Bundle.entry.resource.managingOrganization.resolve().name', options),
    ).toEqual(['Acme', 'Other']);
  });

  it('finds the Bundle around %rootResource for a String literal', () => {
    expect(run(bundle, "'urn:uuid:5c4b'.resolve().id", options)).toEqual(['o1']);
    const [entry] = run(bundle, 'Bundle.entry[1].resource', { ...options, output: 'typed' });
    expect(run(entry, "'Patient/p1'.resolve().id", options)).toEqual(['p1']);
  });

  it('ignores what does not resolve, in input order, without an error', () => {
    expect(run(patient, "('#missing' | 'Patient/p1' | '#o1').resolve().id", options)).toEqual([
      'o1',
    ]);
    expect(run(patient, '(1 | true).resolve()', options)).toEqual([]);
    expect(run(patient, 'Patient.missing.resolve()', options)).toEqual([]);
    expect(run({ reference: '#o1' }, 'resolve()', options)).toEqual([]);
  });

  it('gives the same results in async mode', async () => {
    expect(
      await evaluateAsync(bundle, 'Bundle.entry.resource.subject.resolve().id', options),
    ).toEqual(['p1', 'o1', 'p1', 'p3']);
  });
});

describe('resolve() and the host options', () => {
  it('uses the rootResource option for references in the evaluated resource', () => {
    // A contained resource evaluated on its own, with its container passed by the host.
    const contained = patient.contained[1];
    expect(run(contained, 'managingOrganization.resolve().name')).toEqual([]);
    expect(
      run(contained, 'managingOrganization.resolve().name', { rootResource: patient }),
    ).toEqual(['Acme']);
    expect(run(null, "'#o1'.resolve().name", { rootResource: patient })).toEqual(['Acme']);
  });
});

describe('resolve() with a model', () => {
  it('reads only Reference values among typed complex values', () => {
    expect(
      run(patient, 'Patient.managingOrganization.resolve().name', { model: stubModel }),
    ).toEqual(['Acme']);
    // A typed node of another type with a `reference` key is not a Reference.
    const coding = {
      resourceType: 'Patient',
      contained: [organization],
      name: [{ text: 'x', reference: '#o1' }],
    };
    expect(run(coding, 'Patient.name.resolve()', { model: stubModel })).toEqual([]);
    expect(run(coding, 'Patient.name.resolve().name')).toEqual(['Acme']);
  });

  it('types a resolved resource like navigation does', () => {
    expect(run(patient, "'#o1'.resolve() is Organization", { model: stubModel })).toEqual([true]);
    expect(run(bundle, "'urn:uuid:5c4b'.resolve() is Observation", { model: stubModel })).toEqual([
      true,
    ]);
  });
});
