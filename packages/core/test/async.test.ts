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
