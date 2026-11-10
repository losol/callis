/// <reference types="node" />
/**
 * Sync and async evaluation through one closure tree
 * ([ADR-0004](../../../docs/adr/0004-sync-core-async-path.md),
 * [T0021: sync and async](../../../docs/tasks/T0021-hooks-async.md#sync-and-async)).
 *
 * Every lambda helper runs in sync mode and, with a test-only async function, in async mode. A
 * host result that is a thenable is rejected in sync mode and adopted in async mode, including a
 * promise from another realm (`node:vm`) and a custom thenable. This file needs Node.js for
 * `node:vm`, so it lives in `test/`, outside the engine sources.
 */
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { compile, evaluate, evaluateAsync } from '../src/api/compile.ts';
import { FhirPathError } from '../src/errors/fhirpath-error.ts';
import type { Collection } from '../src/runtime/collection.ts';
import type { EvaluationHooks } from '../src/runtime/hooks.ts';
import { customThenable, hostFunction, testRegistry } from './support/test-functions.ts';

const input = {
  resourceType: 'Patient',
  name: [{ given: ['Peter', 'James'] }, { given: ['Jim'] }, { family: 'Windsor' }],
};

/** A promise created in another realm: `instanceof Promise` is false for it. */
function crossRealmPromise<T>(value: T): PromiseLike<T> {
  const promise = runInNewContext('Promise.resolve(value)', { value }) as PromiseLike<T>;
  expect(promise instanceof Promise).toBe(false);
  return promise;
}

const crossRealm = hostFunction('crossRealm', (items) => crossRealmPromise(items));
const thenable = hostFunction('thenable', (items) => customThenable(items));
const rejecting = hostFunction('rejecting', () => Promise.reject(new Error('host failed')));
const functions = testRegistry(crossRealm, thenable, rejecting);

async function codeOf(action: () => unknown): Promise<string | undefined> {
  try {
    await action();
  } catch (error) {
    return error instanceof FhirPathError ? error.code : `not a FhirPathError: ${String(error)}`;
  }
  return undefined;
}

/** Each lambda helper, and the same expression with an async function inside the lambda. */
const helpers: readonly [string, string, string, unknown[]][] = [
  [
    'forItem() in where',
    'name.testWhere(family is String)',
    'name.testWhere(family.testAsync() is String)',
    [{ family: 'Windsor' }],
  ],
  [
    'forItem() in select',
    'name.testSelect(given)',
    'name.testSelect(given.testAsync())',
    ['Peter', 'James', 'Jim'],
  ],
  [
    'forItem() with $index',
    'name.testSelect($index)',
    'name.testSelect($index.testAsync())',
    [0, 1, 2],
  ],
  [
    'inPlace() in iif',
    "testIif(true, name.given, 'no')",
    "testIif(true, name.given.testAsync(), 'no')",
    ['Peter', 'James', 'Jim'],
  ],
  [
    'a value argument',
    "testIif(name.exists, 'yes', 'no')",
    "testIif(name.testAsync().exists, 'yes', 'no')",
    ['no'],
  ],
];

describe('lambda helpers', () => {
  it.each(helpers)('%s works in sync mode', (_label, syncExpression, _async, expected) => {
    expect(evaluate(input, syncExpression, { functions })).toEqual(expected);
  });

  it.each(helpers)(
    '%s works in async mode',
    async (_label, syncExpression, asyncExpression, expected) => {
      await expect(evaluateAsync(input, syncExpression, { functions })).resolves.toEqual(expected);
      await expect(evaluateAsync(input, asyncExpression, { functions })).resolves.toEqual(expected);
    },
  );

  it.each(helpers)(
    '%s with an async function raises eval/async-in-sync in sync mode',
    async (_label, _sync, asyncExpression) => {
      expect(await codeOf(() => evaluate(input, asyncExpression, { functions }))).toBe(
        'eval/async-in-sync',
      );
    },
  );

  it('keeps the input order when the items finish at different times', async () => {
    let calls = 0;
    const delayed = hostFunction('delayed', async (items) => {
      calls++;
      // Later items finish first.
      for (let tick = 0; tick < 10 - calls; tick++) {
        await Promise.resolve();
      }
      return items;
    });
    const result = await evaluateAsync(input, 'name.given.testSelect($this.delayed())', {
      functions: testRegistry(delayed),
    });
    expect(result).toEqual(['Peter', 'James', 'Jim']);
  });

  it('evaluates items one after another, never overlapping', async () => {
    let running = 0;
    let most = 0;
    const tracked = hostFunction('tracked', async (items) => {
      running++;
      most = Math.max(most, running);
      await Promise.resolve();
      await Promise.resolve();
      running--;
      return items;
    });
    await evaluateAsync(input, 'name.given.testSelect($this.tracked())', {
      functions: testRegistry(tracked),
    });
    expect(most).toBe(1);
  });
});

describe('host results that are thenables', () => {
  it.each(['crossRealm', 'thenable', 'testThenable', 'testAsync'])(
    '%s() is adopted in async mode',
    async (name) => {
      await expect(evaluateAsync(input, `name.given.${name}()`, { functions })).resolves.toEqual([
        'Peter',
        'James',
        'Jim',
      ]);
      await expect(
        evaluateAsync(input, `name.testSelect(given.${name}())`, { functions }),
      ).resolves.toEqual(['Peter', 'James', 'Jim']);
    },
  );

  it.each(['crossRealm', 'thenable', 'testThenable', 'testAsync'])(
    '%s() raises eval/async-in-sync in sync mode',
    async (name) => {
      expect(await codeOf(() => evaluate(input, `name.given.${name}()`, { functions }))).toBe(
        'eval/async-in-sync',
      );
      expect(
        await codeOf(() =>
          evaluate(input, `name.testWhere(family.${name}() is String)`, { functions }),
        ),
      ).toBe('eval/async-in-sync');
    },
  );

  it('reports where the async call is', async () => {
    try {
      evaluate(input, 'true and name.thenable().exists', { functions });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FhirPathError);
      expect((error as FhirPathError).span).toMatchObject({ start: 9, end: 24 });
    }
  });

  it('does not leave an unhandled rejection behind in sync mode', async () => {
    expect(await codeOf(() => evaluate(input, 'rejecting()', { functions }))).toBe(
      'eval/async-in-sync',
    );
    // Give the rejection time to be reported; Vitest fails the run on an unhandled one.
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('passes a rejection through in async mode', async () => {
    await expect(evaluateAsync(input, 'rejecting()', { functions })).rejects.toThrow('host failed');
  });

  it('rejects instead of throwing for compile and evaluation errors in async mode', async () => {
    const pending = evaluateAsync(input, 'noSuchFunction()', { functions });
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).rejects.toMatchObject({ code: 'semantic/unknown-function' });
    await expect(evaluateAsync(input, '%missing', { functions })).rejects.toMatchObject({
      code: 'eval/undefined-variable',
    });
  });
});

// The trace hook is a host boundary too (T0017, docs/spec-notes.md#trace-names-and-projections).
describe('a trace hook that returns a thenable', () => {
  const results: readonly [string, () => PromiseLike<void>][] = [
    ['a promise from another realm', () => crossRealmPromise(undefined)],
    ['a custom thenable', () => customThenable(undefined)],
  ];

  it.each(results)('waits for %s in async mode', async (_label, result) => {
    const names: string[] = [];
    const hooks = {
      trace: (event: { readonly name: string }) => {
        names.push(event.name);
        return result();
      },
    };
    await expect(
      evaluateAsync(input, "trace('a').name.trace('b').count()", { hooks }),
    ).resolves.toEqual([3]);
    expect(names).toEqual(['a', 'b']);
  });

  it.each(results)('rejects %s with eval/async-in-sync in sync mode', async (_label, result) => {
    const hooks = { trace: result };
    expect(await codeOf(() => evaluate(input, "trace('a')", { hooks }))).toBe('eval/async-in-sync');
  });
});

// docs/tasks/T0021-hooks-async.md#host-hooks: every hook is a host boundary like a function.
describe('hooks that return thenables', () => {
  const referring = {
    resourceType: 'Patient',
    id: 'p1',
    managingOrganization: { reference: 'Organization/o1' },
  };
  const variables = { a: { system: 's', code: 'a' }, b: { system: 's', code: 'b' } };
  const hooksWith = (wrap: <T>(value: T) => PromiseLike<T>): EvaluationHooks => ({
    resolve: () => wrap({ resourceType: 'Organization', id: 'o1', name: 'Acme' }),
    conformsTo: () => wrap(true),
    htmlChecks: () => wrap(false),
    terminology: { memberOf: () => wrap(true), subsumes: () => wrap('subsumes' as const) },
  });
  const cases: readonly [string, unknown[]][] = [
    ['managingOrganization.resolve().name', ['Acme']],
    ["conformsTo('http://hl7.org/fhir/StructureDefinition/Patient')", [true]],
    ["'<p/>'.htmlChecks()", [false]],
    ["id.memberOf('http://example.org/vs')", [true]],
    ['%a.subsumes(%b)', [true]],
    ['%b.subsumedBy(%a)', [false]],
  ];

  it.each(cases)(
    '%s adopts a cross-realm promise and a custom thenable in async mode',
    async (expression, expected) => {
      for (const wrap of [crossRealmPromise, customThenable]) {
        await expect(
          evaluateAsync(referring, expression, { hooks: hooksWith(wrap), variables }),
        ).resolves.toEqual(expected);
      }
    },
  );

  it.each(cases)('%s raises eval/async-in-sync in sync mode', async (expression) => {
    for (const wrap of [crossRealmPromise, customThenable]) {
      expect(
        await codeOf(() => evaluate(referring, expression, { hooks: hooksWith(wrap), variables })),
      ).toBe('eval/async-in-sync');
    }
  });
});

// docs/tasks/T0021-hooks-async.md#acceptance-criteria: resolve() through the hook, end to end.
describe('resolve() through an async hook', () => {
  const directory: Readonly<Record<string, unknown>> = {
    'Patient/1': { resourceType: 'Patient', id: '1', name: [{ family: 'One' }] },
    'Patient/2': { resourceType: 'Patient', id: '2', name: [{ family: 'Two' }] },
    'Patient/3': { resourceType: 'Patient', id: '3', name: [{ family: 'Three' }] },
  };
  const bundle = {
    resourceType: 'Bundle',
    entry: ['Patient/1', 'Patient/2', 'Patient/3'].map((reference, index) => ({
      fullUrl: `urn:uuid:${index}`,
      resource: { resourceType: 'Observation', id: `o${index}`, subject: { reference } },
    })),
  };
  const expression = 'Bundle.entry.resource.subject.resolve().name.family';
  const lookUp = (reference: string): unknown => directory[reference];

  it('returns the results in input order, within the concurrency, when later calls finish first', async () => {
    const release: (() => void)[] = [];
    let running = 0;
    let most = 0;
    const hooks: EvaluationHooks = {
      resolve: (reference) => {
        running++;
        most = Math.max(most, running);
        return new Promise<unknown>((resolve) =>
          release.push(() => {
            running--;
            resolve(lookUp(reference));
          }),
        );
      },
    };
    const pending = compile(expression).evaluateAsync(bundle, { hooks, concurrency: 2 });
    expect(release).toHaveLength(2);
    release[1]?.();
    for (let turn = 0; turn < 8; turn++) {
      await Promise.resolve();
    }
    expect(release).toHaveLength(3);
    release[2]?.();
    release[0]?.();
    await expect(pending).resolves.toEqual(['One', 'Two', 'Three']);
    expect(most).toBe(2);
  });

  it('works through evaluate() with a synchronous hook', () => {
    expect(evaluate(bundle, expression, { hooks: { resolve: lookUp } })).toEqual([
      'One',
      'Two',
      'Three',
    ]);
  });

  it('raises eval/async-in-sync in evaluate() with an asynchronous hook', async () => {
    const hooks: EvaluationHooks = { resolve: async (reference) => lookUp(reference) };
    expect(await codeOf(() => evaluate(bundle, expression, { hooks }))).toBe('eval/async-in-sync');
  });

  // docs/tasks/T0021-hooks-async.md#sync-and-async: cancellation with any AbortSignal.
  it('stops with eval/aborted at the next hook call after the signal is aborted', async () => {
    const controller = new AbortController();
    const signals: unknown[] = [];
    let calls = 0;
    const hooks: EvaluationHooks = {
      resolve: async (reference, context) => {
        calls++;
        signals.push(context.signal);
        if (calls === 1) {
          controller.abort(new Error('the user left'));
        }
        return lookUp(reference);
      },
    };
    let failure: unknown;
    try {
      await evaluateAsync(bundle, expression, { hooks, signal: controller.signal, concurrency: 1 });
      expect.unreachable();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(FhirPathError);
    expect((failure as FhirPathError).code).toBe('eval/aborted');
    // The reason stays the cause, also once the span of the call is attached.
    expect((failure as FhirPathError).cause).toBe(controller.signal.reason);
    expect((failure as FhirPathError).span).toBeDefined();
    expect(calls).toBe(1);
    expect(signals).toEqual([controller.signal]);
  });

  it('does not start more hook calls of a collection once the signal is aborted', async () => {
    const controller = new AbortController();
    let calls = 0;
    const hooks: EvaluationHooks = {
      resolve: (reference) => {
        calls++;
        controller.abort();
        return Promise.resolve(lookUp(reference));
      },
    };
    await expect(
      evaluateAsync(bundle, expression, { hooks, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'eval/aborted' });
    expect(calls).toBe(1);
  });

  it('stops after a user-defined async function once the signal is aborted', async () => {
    const controller = new AbortController();
    const aborting = hostFunction('aborting', async (items) => {
      controller.abort();
      return items;
    });
    await expect(
      evaluateAsync(input, 'name.given.aborting().count()', {
        functions: testRegistry(aborting),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'eval/aborted', span: { start: 0, end: 21 } });
  });
});

describe('concurrent evaluations', () => {
  it('runs two overlapping async evaluations of one compiled expression without interference', async () => {
    const release: (() => void)[] = [];
    const gated = hostFunction(
      'gated',
      (items) => new Promise<Collection>((resolve) => release.push(() => resolve(items))),
    );
    const compiled = compile('name.given.gated().testSelect(%prefix)', {
      functions: testRegistry(gated),
    });
    const first = compiled.evaluateAsync(
      { name: [{ given: ['a'] }] },
      { variables: { prefix: 'first' } },
    );
    const second = compiled.evaluateAsync(
      { name: [{ given: ['b', 'c'] }] },
      { variables: { prefix: 'second' } },
    );
    // Both evaluations now wait inside gated(). Let the second one finish first.
    expect(release).toHaveLength(2);
    release[1]?.();
    await expect(second).resolves.toEqual(['second', 'second']);
    release[0]?.();
    await expect(first).resolves.toEqual(['first']);
  });

  it('gives each evaluation its own frames and variables', async () => {
    const compiled = compile('name.testSelect($index.testAsync()).testSelect(%v)', { functions });
    const results = await Promise.all(
      ['x', 'y', 'z'].map((v) => compiled.evaluateAsync(input, { variables: { v } })),
    );
    expect(results).toEqual([
      ['x', 'x', 'x'],
      ['y', 'y', 'y'],
      ['z', 'z', 'z'],
    ]);
  });
});
