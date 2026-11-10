import { describe, expect, it } from 'vitest';
import { hooksFor, MODES } from '../../test/support/hook-modes.ts';
import { stubModel } from '../../test/support/stub-model.ts';
import {
  type CompileOptions,
  compile,
  type EvaluateOptions,
  evaluate,
  evaluateAsync,
} from '../api/compile.ts';
import { ModelNode } from '../model/model-node.ts';
import type { ResolveContext } from '../runtime/hooks.ts';

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

// docs/tasks/T0021-hooks-async.md#host-hooks: the hook for what is not in the data.
describe.each(MODES)('resolve() with a resolve hook, %s', (_label, run, isAsync) => {
  const remote = { resourceType: 'Organization', id: 'o9', name: 'Remote' };
  const answers: Readonly<Record<string, unknown>> = {
    'Organization/o9': remote,
    'http://example.org/fhir/Organization/o9': remote,
    'Patient/p1': { resourceType: 'Patient', id: 'p1', name: [{ family: 'Remote' }] },
    'Patient/nothing': null,
    'Patient/broken': () => undefined,
  };

  function hook(options: CompileOptions & EvaluateOptions = {}): {
    readonly calls: [string, ResolveContext][];
    readonly options: CompileOptions & EvaluateOptions;
  } {
    const calls: [string, ResolveContext][] = [];
    const hooks = hooksFor(
      {
        resolve: (reference, context) => {
          calls.push([reference, context]);
          return Object.hasOwn(answers, reference) ? answers[reference] : undefined;
        },
      },
      isAsync,
    );
    return { calls, options: { ...options, hooks } };
  }

  it('asks the hook for a reference that is not in the data, with the resource around it', async () => {
    const { calls, options } = hook();
    const input = observation('o1', 'Organization/o9');
    await expect(run(input, 'Observation.subject.resolve().name', options)).resolves.toEqual([
      'Remote',
    ]);
    expect(calls).toEqual([['Organization/o9', { signal: undefined, resource: input }]]);
    expect(calls[0]?.[1].resource).toBe(input);
  });

  it('passes no resource for a String literal, and the signal it was given', async () => {
    const signal = { aborted: false };
    const { calls, options } = hook({ signal });
    await expect(run(null, "'Organization/o9'.resolve().id", options)).resolves.toEqual(['o9']);
    expect(calls).toEqual([['Organization/o9', { signal, resource: undefined }]]);
    expect(calls[0]?.[1].signal).toBe(signal);
  });

  it('does not ask the hook for what is in the data, nor for a contained reference', async () => {
    const { calls, options } = hook();
    await expect(
      run(patient, 'Patient.managingOrganization.resolve().name', options),
    ).resolves.toEqual(['Acme']);
    await expect(run(patient, "'#missing'.resolve()", options)).resolves.toEqual([]);
    await expect(run(bundle, "'urn:uuid:5c4b'.resolve().id", options)).resolves.toEqual(['o1']);
    expect(calls).toEqual([]);
  });

  it('types the result like the input, as a root node', async () => {
    const typed = hook({ model: stubModel, output: 'typed' });
    const [resolved] = await run(null, "'Organization/o9'.resolve()", typed.options);
    expect(resolved).toBeInstanceOf(ModelNode);
    expect((resolved as ModelNode).type?.name).toBe('Organization');
    expect((resolved as ModelNode).parent).toBeUndefined();
    expect((resolved as ModelNode).value).toBe(remote);
    await expect(
      run(null, "'Organization/o9'.resolve() is Organization", hook({ model: stubModel }).options),
    ).resolves.toEqual([true]);
    const [untyped] = await run(
      null,
      "'Organization/o9'.resolve()",
      hook({ output: 'typed' }).options,
    );
    expect((untyped as ModelNode).type).toBeUndefined();
    await expect(run(null, "'Organization/o9'.resolve().name", hook().options)).resolves.toEqual([
      'Remote',
    ]);
  });

  it('resolves nothing for undefined and null, and rejects a result that is not JSON', async () => {
    const { calls, options } = hook();
    await expect(
      run(null, "('Patient/nothing' | 'Patient/unknown').resolve()", options),
    ).resolves.toEqual([]);
    expect(calls.map(([reference]) => reference)).toEqual(['Patient/nothing', 'Patient/unknown']);
    await expect(run(null, "'Patient/broken'.resolve()", options)).rejects.toMatchObject({
      code: 'eval/invalid-argument',
    });
  });

  it('keeps the input order, with resources from the data and from the hook mixed', async () => {
    const { calls, options } = hook();
    const mixed = {
      resourceType: 'Bundle',
      entry: [
        { fullUrl: 'urn:uuid:1', resource: observation('x1', 'Patient/p1') },
        { fullUrl: 'urn:uuid:2', resource: observation('x2', 'urn:uuid:4') },
        { fullUrl: 'urn:uuid:3', resource: observation('x3', 'Organization/o9') },
        { fullUrl: 'urn:uuid:4', resource: { resourceType: 'Patient', id: 'local' } },
      ],
    };
    await expect(
      run(mixed, 'Bundle.entry.resource.subject.resolve().id', options),
    ).resolves.toEqual(['p1', 'local', 'o9']);
    expect(calls.map(([reference]) => reference)).toEqual(['Patient/p1', 'Organization/o9']);
  });
});

describe('resolve() with an async hook', () => {
  const references = ['Patient/1', 'Patient/2', 'Patient/3', 'Patient/4', 'Patient/5'];
  const bundleOf = (subjects: readonly string[]) => ({
    resourceType: 'Bundle',
    entry: subjects.map((subject, index) => ({
      fullUrl: `urn:uuid:${index}`,
      resource: observation(`o${index}`, subject),
    })),
  });

  it('raises eval/async-in-sync in evaluate()', () => {
    const hooks = {
      resolve: async (reference: string) => ({ resourceType: 'Patient', id: reference }),
    };
    expect(() => evaluate(null, "'Patient/1'.resolve()", { hooks })).toThrow(
      expect.objectContaining({ code: 'eval/async-in-sync' }),
    );
  });

  it('starts the calls of one collection concurrently, up to the concurrency, in order', async () => {
    const release: (() => void)[] = [];
    const started: string[] = [];
    let running = 0;
    let most = 0;
    const hooks = {
      resolve: (reference: string) => {
        started.push(reference);
        running++;
        most = Math.max(most, running);
        return new Promise<unknown>((resolve) =>
          release.push(() => {
            running--;
            resolve({ resourceType: 'Patient', id: reference.slice('Patient/'.length) });
          }),
        );
      },
    };
    // The compiled expression starts evaluating at once; evaluateAsync() starts on a microtask.
    const pending = compile('Bundle.entry.resource.subject.resolve().id').evaluateAsync(
      bundleOf(references),
      { hooks, concurrency: 2 },
    );
    expect(started).toEqual(['Patient/1', 'Patient/2']);
    // The call started last finishes first, and each finished call lets the next one start.
    const settle = async (): Promise<void> => {
      for (let turn = 0; turn < 8; turn++) {
        await Promise.resolve();
      }
    };
    while (started.length < references.length) {
      release.pop()?.();
      await settle();
    }
    while (release.length > 0) {
      release.pop()?.();
      await settle();
    }
    await expect(pending).resolves.toEqual(['1', '2', '3', '4', '5']);
    expect(started).toEqual(references);
    expect(most).toBe(2);
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
