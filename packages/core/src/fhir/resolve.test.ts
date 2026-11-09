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

  // An input with several resources: each keeps its own contained resources and Bundle.
  it('resolves the references of each input resource in that resource', () => {
    const owner = (id: string, organizations: Record<string, string>, reference: string) => ({
      resourceType: 'Patient',
      id,
      contained: Object.entries(organizations).map(([orgId, name]) => ({
        resourceType: 'Organization',
        id: orgId,
        name,
      })),
      managingOrganization: { reference },
    });
    const patients = [
      owner('p1', { o1: 'First', o2: 'Only in the first' }, '#o1'),
      owner('p2', { o1: 'Second' }, '#o1'),
      // #o2 is only in the first Patient, so it does not resolve here.
      owner('p3', { o1: 'Third' }, '#o2'),
    ];
    expect(run(patients, 'managingOrganization.resolve().name', options)).toEqual([
      'First',
      'Second',
    ]);
    // A String literal belongs to no resource: the first of %rootResource that has the id.
    expect(run(patients, "'#o2'.resolve().name", options)).toEqual(['Only in the first']);
    expect(run(patients, "'#o1'.resolve().name", options)).toEqual(['First']);
  });

  // https://hl7.org/fhir/R5/bundle.html#references: a relative reference takes the RESTful base
  // of the fullUrl of the entry it is in.
  it('resolves a relative reference against the base of the entry it is in', () => {
    const server = (base: string, type: string, id: string, extra: object = {}) => ({
      fullUrl: `${base}${type}/${id}`,
      resource: { resourceType: type, id, ...extra },
    });
    const A = 'https://a.example/fhir/';
    const B = 'https://b.example/fhir/';
    const twoServers = {
      resourceType: 'Bundle',
      entry: [
        server(B, 'Patient', 'p', { name: [{ family: 'B' }] }),
        server(A, 'Patient', 'p', { name: [{ family: 'A' }], meta: { versionId: '3' } }),
        server(B, 'Patient', 'q'),
        server(A, 'Observation', 'o1', { subject: { reference: 'Patient/p' } }),
        // The only Patient/q is on server B, so a reference from server A does not resolve.
        server(A, 'Observation', 'o2', { subject: { reference: 'Patient/q' } }),
        server(B, 'Observation', 'o3', { subject: { reference: 'Patient/p' } }),
        server(A, 'Observation', 'o4', { subject: { reference: 'Patient/p/_history/3' } }),
        server(A, 'Observation', 'o5', { subject: { reference: 'Patient/p/_history/2' } }),
        server(A, 'Patient', 'c', {
          contained: [
            { resourceType: 'Observation', id: 'x', subject: { reference: 'Patient/p' } },
          ],
        }),
        { fullUrl: 'urn:uuid:7', resource: observation('o6', 'Patient/p') },
      ],
    };
    const families = (expression: string) => run(twoServers, expression, options);
    expect(
      families("Bundle.entry.resource.where(id = 'o1').subject.resolve().name.family"),
    ).toEqual(['A']);
    expect(families("Bundle.entry.resource.where(id = 'o2').subject.resolve()")).toEqual([]);
    expect(
      families("Bundle.entry.resource.where(id = 'o3').subject.resolve().name.family"),
    ).toEqual(['B']);
    expect(
      families("Bundle.entry.resource.where(id = 'o4').subject.resolve().name.family"),
    ).toEqual(['A']);
    expect(families("Bundle.entry.resource.where(id = 'o5').subject.resolve()")).toEqual([]);
    // A contained resource takes the base of the entry of its container.
    expect(families('Bundle.entry.resource.contained.subject.resolve().name.family')).toEqual([
      'A',
    ]);
    // Without a RESTful base the spec leaves Type/id undefined; Callis matches type and id.
    expect(
      families("Bundle.entry.resource.where(id = 'o6').subject.resolve().name.family"),
    ).toEqual(['B']);
    expect(families("'https://a.example/fhir/Patient/p'.resolve().name.family")).toEqual(['A']);
  });

  it('looks up the references of each input Bundle in that Bundle', () => {
    const entry = (fullUrl: string, resource: object) => ({ fullUrl, resource });
    const bundles = [
      {
        resourceType: 'Bundle',
        entry: [
          entry('urn:uuid:a', { resourceType: 'Patient', id: 'only-in-first' }),
          entry('urn:uuid:b', observation('x1', 'Patient/only-in-first')),
        ],
      },
      {
        resourceType: 'Bundle',
        entry: [
          entry('urn:uuid:c', { resourceType: 'Patient', id: 'p9' }),
          entry('urn:uuid:d', observation('x2', 'Patient/only-in-first')),
          entry('urn:uuid:e', observation('x3', 'urn:uuid:c')),
        ],
      },
    ];
    expect(run(bundles, 'Bundle.entry.resource.subject.resolve().id', options)).toEqual([
      'only-in-first',
      'p9',
    ]);
    // A String literal: each Bundle of %rootResource in turn.
    expect(run(bundles, "'urn:uuid:c'.resolve().id", options)).toEqual(['p9']);
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
