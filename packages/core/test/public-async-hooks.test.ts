/// <reference types="node" />
/**
 * Asynchronous evaluation, host hooks, the signal, the clock and the limits through the public
 * entry point ([T0038b](../../../docs/tasks/T0038b-public-async-hooks-limits.md),
 * [T0021: host hooks](../../../docs/tasks/T0021-hooks-async.md#host-hooks)). Every hook-backed
 * function runs in sync and async mode, with hooks that answer directly, with a native promise, a
 * promise from another realm (`node:vm`) and a custom thenable
 * ([ADR-0004](../../../docs/adr/0004-sync-core-async-path.md)). This file needs Node.js for
 * `node:vm`, so it lives in `test/`.
 */
import { runInNewContext } from 'node:vm';
import { r4 } from '@callis/fhir-r4';
import { r5 } from '@callis/fhir-r5';
import { r6 } from '@callis/fhir-r6';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { evaluateAsync as evaluateAsyncInternal } from '../src/api/compile.ts';
import {
  type CancellationSignal,
  type CodedValue,
  type Coding,
  type CompiledExpression,
  type CompileOptions,
  compile,
  type EvaluateOptions,
  type EvaluationHooks,
  type EvaluationLimits,
  evaluate,
  evaluateAsync,
  FhirPathError,
  type HookContext,
  type HookResult,
  type HtmlChecksContext,
  type ModelProvider,
  type RegexMatcher,
  type ResolveContext,
  type SubsumptionOutcome,
  type TerminologyProvider,
  type TraceEvent,
} from '../src/index.ts';
import { customThenable } from './support/test-functions.ts';

type Options = CompileOptions & EvaluateOptions;

/** How a mode evaluates: `evaluate()` or `evaluateAsync()`, with the options as they are. */
type Run = (input: unknown, expression: string, options?: Options) => Promise<unknown[]>;

/** Sync and async mode, each one-off and compiled. */
const MODES: readonly (readonly [label: string, run: Run, isAsync: boolean])[] = [
  ['evaluate()', async (input, expression, options) => evaluate(input, expression, options), false],
  [
    'compile().evaluate()',
    async (input, expression, options = {}) =>
      compile(expression, compileOptionsOf(options)).evaluate(input, evaluateOptionsOf(options)),
    false,
  ],
  [
    'evaluateAsync()',
    (input, expression, options) => evaluateAsync(input, expression, options),
    true,
  ],
  [
    'compile().evaluateAsync()',
    (input, expression, options = {}) =>
      compile(expression, compileOptionsOf(options)).evaluateAsync(
        input,
        evaluateOptionsOf(options),
      ),
    true,
  ],
];

const COMPILE_KEYS = new Set(['model', 'inputType', 'lenient', 'units', 'strict']);

function compileOptionsOf(options: Options): CompileOptions {
  return Object.fromEntries(Object.entries(options).filter(([key]) => COMPILE_KEYS.has(key)));
}

function evaluateOptionsOf(options: Options): EvaluateOptions {
  return Object.fromEntries(Object.entries(options).filter(([key]) => !COMPILE_KEYS.has(key)));
}

/** The code of the FhirPathError that `action` throws or rejects with, or undefined. */
async function codeOf(action: () => unknown): Promise<string | undefined> {
  try {
    await action();
  } catch (error) {
    return error instanceof FhirPathError ? error.code : `not a FhirPathError: ${String(error)}`;
  }
  return undefined;
}

/** The error that `action` throws or rejects with. */
async function errorOf(action: () => unknown): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return expect.unreachable('expected an error');
}

/** A promise created in another realm: `instanceof Promise` is false for it. */
function crossRealmPromise<T>(value: T): PromiseLike<T> {
  const promise = runInNewContext('Promise.resolve(value)', { value }) as PromiseLike<T>;
  expect(promise instanceof Promise).toBe(false);
  return promise;
}

/** The ways a hook answers asynchronously. */
const WRAPS: readonly (readonly [label: string, wrap: <T>(value: T) => PromiseLike<T>])[] = [
  ['a native promise', (value) => Promise.resolve(value)],
  ['a promise from another realm', crossRealmPromise],
  ['a custom thenable', customThenable],
];

/**
 * The hooks with every answer but `regex`, which is synchronous, wrapped by `wrap`. `hooks` must
 * answer with values, as {@link syncHooks} does.
 */
function wrapHooks(hooks: EvaluationHooks, wrap: <T>(value: T) => PromiseLike<T>): EvaluationHooks {
  const terminology = hooks.terminology;
  // The answer is a value, not a thenable, so wrapping it gives a thenable of that value.
  const later = <T>(answer: HookResult<T>): PromiseLike<T> => wrap(answer as T);
  return {
    ...(hooks.resolve === undefined
      ? {}
      : { resolve: (reference, context) => later(hooks.resolve?.(reference, context)) }),
    ...(hooks.conformsTo === undefined
      ? {}
      : {
          conformsTo: (value, profile, context) =>
            later(hooks.conformsTo?.(value, profile, context)),
        }),
    ...(hooks.htmlChecks === undefined
      ? {}
      : { htmlChecks: (html, context) => later(hooks.htmlChecks?.(html, context)) }),
    ...(hooks.regex === undefined ? {} : { regex: hooks.regex }),
    ...(hooks.trace === undefined
      ? {}
      : {
          trace: (event) => {
            hooks.trace?.(event);
            return wrap(undefined);
          },
        }),
    ...(terminology === undefined
      ? {}
      : {
          terminology: {
            memberOf: (coded, valueSet, context) =>
              later(terminology.memberOf?.(coded, valueSet, context)),
            subsumes: (a, b, context) => later(terminology.subsumes?.(a, b, context)),
          },
        }),
  };
}

const organization = { resourceType: 'Organization', id: 'o1', name: 'Acme' };
const patient = {
  resourceType: 'Patient',
  id: 'p1',
  managingOrganization: { reference: 'Organization/o1' },
  text: { status: 'generated', div: '<div xmlns="http://www.w3.org/1999/xhtml">Ada</div>' },
  maritalStatus: { coding: [{ system: 'http://example.org/cs', code: 'M' }] },
};
const codings = {
  parent: { system: 'http://example.org/cs', code: 'parent' },
  child: { system: 'http://example.org/cs', code: 'child' },
};

/** Synchronous hooks that answer as a small terminology server, profile validator and so on. */
function syncHooks(): EvaluationHooks {
  return {
    resolve: (reference) => (reference === 'Organization/o1' ? organization : undefined),
    terminology: {
      memberOf: (coded) => coded.codings.some((coding) => coding.code === 'M'),
      subsumes: (a, b) =>
        a.code === 'parent' && b.code === 'child'
          ? 'subsumes'
          : a.code === 'child' && b.code === 'parent'
            ? 'subsumed-by'
            : 'not-subsumed',
    },
    conformsTo: (_value, profile) => profile.endsWith('/Patient'),
    htmlChecks: (html) => html.includes('Ada'),
    regex: (pattern, flags) => {
      const expression = new RegExp(pattern, flags);
      return {
        test: (text) => expression.test(text),
        matchAll: (text) => text.matchAll(new RegExp(pattern, `${flags}g`)),
      };
    },
  };
}

/** Every hook-backed function, with what it gives through {@link syncHooks}. */
const HOOK_CASES: readonly (readonly [expression: string, expected: unknown[]])[] = [
  ['managingOrganization.resolve().name', ['Acme']],
  ["maritalStatus.memberOf('http://example.org/vs')", [true]],
  ['%parent.subsumes(%child)', [true]],
  ['%child.subsumedBy(%parent)', [true]],
  ['%child.subsumes(%parent)', [false]],
  ["conformsTo('http://hl7.org/fhir/StructureDefinition/Patient')", [true]],
  ["conformsTo('http://hl7.org/fhir/StructureDefinition/Observation')", [false]],
  ['text.`div`.htmlChecks()', [true]],
  ["'<b>Ada</b>'.htmlChecks()", [true]],
  ["id.matches('^p[0-9]$')", [true]],
  ["id.replaceMatches('[0-9]', 'X')", ['pX']],
];

describe('every hook-backed function through the public API', () => {
  const variables = codings;

  describe.each(MODES)('with %s', (_label, run, isAsync) => {
    it.each(HOOK_CASES)('%s answers through a synchronous hook', async (expression, expected) => {
      await expect(run(patient, expression, { hooks: syncHooks(), variables })).resolves.toEqual(
        expected,
      );
    });

    it.each(HOOK_CASES)('%s gives empty without hooks', async (expression, expected) => {
      // matches() and replaceMatches() fall back to RegExp; the others give empty.
      const result = await run(patient, expression, { variables });
      expect(result).toEqual(expression.includes('atches(') ? expected : []);
    });

    it.each(HOOK_CASES.filter(([expression]) => !expression.includes('atches(')))(
      `%s ${isAsync ? 'waits for' : 'rejects'} a hook that answers asynchronously`,
      async (expression, expected) => {
        for (const [, wrap] of WRAPS) {
          const hooks = wrapHooks(syncHooks(), wrap);
          if (isAsync) {
            await expect(run(patient, expression, { hooks, variables })).resolves.toEqual(expected);
          } else {
            expect(await codeOf(() => run(patient, expression, { hooks, variables }))).toBe(
              'eval/async-in-sync',
            );
          }
        }
      },
    );

    it('uses the regex hook for matches() and replaceMatches()', async () => {
      const patterns: string[] = [];
      const hooks: EvaluationHooks = {
        regex: (pattern, flags) => {
          patterns.push(`${pattern}/${flags}`);
          return syncHooks().regex?.(pattern, flags) as RegexMatcher;
        },
      };
      expect(
        await run(patient, "id.matches('p.') and id.replaceMatches('1', '2') = 'p2'", { hooks }),
      ).toEqual([true]);
      expect(patterns).toEqual(['p./su', '1/su']);
    });

    it('rejects a regex hook that answers with a promise, as it is synchronous', async () => {
      const hooks = { regex: () => Promise.resolve(/x/) } as unknown as EvaluationHooks;
      expect(await codeOf(() => run(patient, "id.matches('x')", { hooks }))).toBe(
        'eval/invalid-argument',
      );
    });

    it('sends trace() output to the trace hook, converted like the result', async () => {
      const events: TraceEvent[] = [];
      const trace = (event: TraceEvent): void => {
        events.push(event);
      };
      const result = await run(null, "(1.50 | 2.0).trace('decimals').trace('first', first())", {
        hooks: { trace },
        decimalOutput: 'string',
      });
      expect(result).toEqual(['1.50', '2.0']);
      expect(events).toEqual([
        { name: 'decimals', values: ['1.50', '2.0'], span: expect.objectContaining({ line: 1 }) },
        { name: 'first', values: ['1.50', '2.0'], span: expect.objectContaining({ line: 1 }) },
      ]);
    });

    it(`${isAsync ? 'waits for' : 'rejects'} a trace hook that returns a thenable`, async () => {
      for (const [, wrap] of WRAPS) {
        const names: string[] = [];
        const hooks: EvaluationHooks = {
          trace: (event) => {
            names.push(event.name);
            return wrap(undefined);
          },
        };
        const pending = run(null, "1.trace('a').trace('b')", { hooks });
        if (isAsync) {
          await expect(pending).resolves.toEqual([1]);
          expect(names).toEqual(['a', 'b']);
        } else {
          expect(await codeOf(() => pending)).toBe('eval/async-in-sync');
        }
      }
    });

    it('calls each hook with the hooks object or the provider as this, and the signal', async () => {
      const signal: CancellationSignal = { aborted: false };
      const seen: unknown[] = [];
      const terminology: TerminologyProvider = {
        memberOf(this: unknown, _coded: CodedValue, _valueSet: string, context: HookContext) {
          seen.push(this === terminology, context.signal === signal);
          return true;
        },
      };
      const hooks: EvaluationHooks = {
        terminology,
        resolve(this: unknown, _reference: string, context: ResolveContext) {
          seen.push(this === hooks, context.signal === signal, context.resource === patient);
          return organization;
        },
        htmlChecks(this: unknown, _html: string, context: HtmlChecksContext) {
          seen.push(this === hooks, context.kind);
          return true;
        },
      };
      await run(
        patient,
        "managingOrganization.resolve().exists() and maritalStatus.memberOf('vs') and 'x'.htmlChecks()",
        { hooks, signal },
      );
      expect(seen).toEqual([true, true, true, true, true, true, 'string']);
    });

    it('works with hooks that are methods of a class', async () => {
      class Directory {
        readonly #resources: ReadonlyMap<string, unknown>;
        constructor(resources: ReadonlyMap<string, unknown>) {
          this.#resources = resources;
        }
        resolve(reference: string): unknown {
          return this.#resources.get(reference);
        }
      }
      const hooks = new Directory(new Map([['Organization/o1', organization]]));
      await expect(run(patient, 'managingOrganization.resolve().name', { hooks })).resolves.toEqual(
        ['Acme'],
      );
    });

    it('passes an error the hook throws through unchanged', async () => {
      const failure = new Error('server down');
      const hooks: EvaluationHooks = {
        resolve: () => {
          throw failure;
        },
      };
      expect(await errorOf(() => run(patient, 'managingOrganization.resolve()', { hooks }))).toBe(
        failure,
      );
    });
  });

  it('passes a rejection through in async mode', async () => {
    const failure = new Error('server down');
    const hooks: EvaluationHooks = { resolve: () => Promise.reject(failure) };
    await expect(evaluateAsync(patient, 'managingOrganization.resolve()', { hooks })).rejects.toBe(
      failure,
    );
  });

  it('does not leave an unhandled rejection behind in sync mode', async () => {
    const hooks: EvaluationHooks = { resolve: () => Promise.reject(new Error('late')) };
    expect(await codeOf(() => evaluate(patient, 'managingOrganization.resolve()', { hooks }))).toBe(
      'eval/async-in-sync',
    );
    // Give the rejection time to be reported; Vitest fails the run on an unhandled one.
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('gives the results of the internal API', async () => {
    for (const [expression] of HOOK_CASES) {
      const options = { hooks: wrapHooks(syncHooks(), customThenable), variables: codings };
      expect(await evaluateAsync(patient, expression, options)).toEqual(
        await evaluateAsyncInternal(patient, expression, options),
      );
    }
  });
});

describe('evaluateAsync()', () => {
  it('evaluates like evaluate() without hooks', async () => {
    for (const expression of [
      "name.where(given = 'Ada').given",
      '1.50 + 1',
      '@2020-01-01 + 1 day',
    ]) {
      const input = { name: [{ given: ['Ada'] }, { given: ['Mina'] }] };
      const options = { decimalOutput: 'string' } as const;
      await expect(evaluateAsync(input, expression, options)).resolves.toEqual(
        evaluate(input, expression, options),
      );
      await expect(compile(expression).evaluateAsync(input, options)).resolves.toEqual(
        compile(expression).evaluate(input, options),
      );
    }
  });

  it('rejects, and never throws, for every kind of error', async () => {
    const cases: readonly (readonly [() => Promise<unknown[]>, string])[] = [
      [() => evaluateAsync(null, 'Patient.'), 'syntax/unexpected-token'],
      [() => evaluateAsync(null, 'noSuchFunction()'), 'semantic/unknown-function'],
      [() => evaluateAsync(null, "1 + 'a'", { strict: true }), 'semantic/type-mismatch'],
      [() => evaluateAsync(null, '%missing'), 'eval/undefined-variable'],
      [() => evaluateAsync(null, 42 as never), 'eval/invalid-argument'],
      [() => evaluateAsync(null, '1', null as never), 'eval/invalid-argument'],
      [() => evaluateAsync(null, '1', { output: 'typed' } as never), 'eval/invalid-argument'],
      [() => evaluateAsync(null, '1', { functions: {} } as never), 'eval/invalid-argument'],
      [() => compile('1').evaluateAsync(null, { strict: true } as never), 'eval/invalid-argument'],
      [() => compile('%missing').evaluateAsync(null), 'eval/undefined-variable'],
    ];
    for (const [start, code] of cases) {
      let pending: Promise<unknown[]> | undefined;
      expect(() => {
        pending = start();
      }).not.toThrow();
      expect(pending).toBeInstanceOf(Promise);
      await expect(pending).rejects.toMatchObject({ code });
    }
  });

  it('reads the options when it is called', async () => {
    const options: { variables: Record<string, unknown> } = { variables: { value: 'first' } };
    const pending = evaluateAsync(null, '%value', options);
    options.variables = { value: 'second' };
    await expect(pending).resolves.toEqual(['first']);
  });

  it('runs overlapping evaluations of one compiled expression independently', async () => {
    const compiled = compile('managingOrganization.resolve().name');
    const later = (name: string, ticks: number): EvaluationHooks => ({
      resolve: async () => {
        for (let tick = 0; tick < ticks; tick++) await Promise.resolve();
        return { resourceType: 'Organization', name };
      },
    });
    const [slow, fast] = await Promise.all([
      compiled.evaluateAsync(patient, { hooks: later('slow', 10) }),
      compiled.evaluateAsync(patient, { hooks: later('fast', 0) }),
    ]);
    expect([slow, fast]).toEqual([['slow'], ['fast']]);
  });
});

// docs/tasks/T0021-hooks-async.md#sync-and-async: cancellation.
describe('the signal option', () => {
  const bundle = {
    resourceType: 'Bundle',
    entry: [1, 2, 3].map((id) => ({
      resource: { resourceType: 'Observation', subject: { reference: `Patient/${id}` } },
    })),
  };
  const expression = 'Bundle.entry.resource.subject.resolve().id';

  it.each(MODES)(
    'stops an aborted evaluation before anything runs with %s',
    async (_label, run) => {
      const reason = new Error('user cancelled');
      const controller = new AbortController();
      controller.abort(reason);
      let calls = 0;
      const hooks: EvaluationHooks = {
        resolve: () => {
          calls++;
          return undefined;
        },
      };
      for (const signal of [controller.signal, { aborted: true, reason }]) {
        const error = await errorOf(() => run(bundle, expression, { hooks, signal }));
        expect(error).toMatchObject({ code: 'eval/aborted', cause: reason });
        expect(await codeOf(() => run(null, '1', { signal }))).toBe('eval/aborted');
      }
      expect(calls).toBe(0);
    },
  );

  it.each(MODES)(
    'stops before the next hook call once a hook aborts with %s',
    async (_label, run) => {
      const controller = new AbortController();
      const seen: string[] = [];
      const hooks: EvaluationHooks = {
        resolve: (reference) => {
          seen.push(reference);
          controller.abort('enough');
          return { resourceType: 'Patient', id: reference };
        },
      };
      const error = await errorOf(() =>
        run(bundle, expression, { hooks, signal: controller.signal, concurrency: 1 }),
      );
      expect(error).toMatchObject({ code: 'eval/aborted', cause: 'enough' });
      expect(seen).toEqual(['Patient/1']);
    },
  );

  it('stops after an awaited hook result once the signal is aborted', async () => {
    const controller = new AbortController();
    let release: (() => void) | undefined;
    const hooks: EvaluationHooks = {
      resolve: () =>
        new Promise((resolve) => {
          release = () => resolve({ resourceType: 'Patient', id: 'x' });
        }),
    };
    const pending = evaluateAsync(bundle, 'Bundle.entry.first().resource.subject.resolve()', {
      hooks,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort('late');
    release?.();
    await expect(pending).rejects.toMatchObject({ code: 'eval/aborted', cause: 'late' });
  });

  it.each(MODES)('rejects a signal that is not one with %s', async (_label, run) => {
    for (const signal of [null, true, 'aborted', {}, { aborted: 'yes' }]) {
      expect(await codeOf(() => run(null, '1', { signal } as never))).toBe('eval/invalid-argument');
    }
  });
});

describe('the concurrency option', () => {
  const references = Array.from({ length: 6 }, (_, index) => `Patient/${index}`);
  const input = { refs: references };

  it('starts at most concurrency hook calls at once and keeps the order', async () => {
    for (const concurrency of [1, 2, 4]) {
      let running = 0;
      let most = 0;
      const hooks: EvaluationHooks = {
        resolve: async (reference) => {
          running++;
          most = Math.max(most, running);
          // Later references finish first.
          for (let tick = 0; tick < 20 - references.indexOf(reference); tick++) {
            await Promise.resolve();
          }
          running--;
          return { resourceType: 'Patient', id: reference };
        },
      };
      await expect(
        evaluateAsync(input, 'refs.resolve().id', { hooks, concurrency }),
      ).resolves.toEqual(references);
      expect(most).toBe(concurrency);
    }
  });

  it('defaults to 8 and accepts Infinity', async () => {
    const many = { refs: Array.from({ length: 20 }, (_, index) => `Patient/${index}`) };
    for (const [concurrency, expected] of [
      [undefined, 8],
      [Number.POSITIVE_INFINITY, 20],
    ] as const) {
      let running = 0;
      let most = 0;
      const hooks: EvaluationHooks = {
        resolve: async (reference) => {
          running++;
          most = Math.max(most, running);
          await Promise.resolve();
          running--;
          return { resourceType: 'Patient', id: reference };
        },
      };
      const options = concurrency === undefined ? { hooks } : { hooks, concurrency };
      await evaluateAsync(many, 'refs.resolve()', options);
      expect(most).toBe(expected);
    }
  });

  it.each(MODES)('is validated with %s, and calls hooks in order', async (_label, run) => {
    const hooks: EvaluationHooks = { resolve: (id) => ({ resourceType: 'Patient', id }) };
    await expect(run(input, 'refs.resolve().id', { hooks, concurrency: 3 })).resolves.toEqual(
      references,
    );
    for (const concurrency of [0, -1, 1.5, Number.NaN, '2', null]) {
      expect(await codeOf(() => run(null, '1', { concurrency } as never))).toBe(
        'eval/invalid-argument',
      );
    }
  });
});

// https://hl7.org/fhirpath/N1/#current-date-and-time-functions
describe('the now option', () => {
  const instant = '2026-01-02T03:04:05.678Z';
  const clockExpression = 'now() | today() | timeOfDay()';
  const expected = ['2026-01-02T03:04:05.678Z', '2026-01-02', '03:04:05.678'];

  it.each(MODES)('fixes the clock with a Date and with a function with %s', async (_label, run) => {
    await expect(run(null, clockExpression, { now: new Date(instant) })).resolves.toEqual(expected);
    let calls = 0;
    const now = (): Date => {
      calls++;
      return new Date(instant);
    };
    await expect(run(null, `${clockExpression} | now()`, { now })).resolves.toEqual(expected);
    expect(calls).toBe(1);
    await expect(run(null, '1', { now })).resolves.toEqual([1]);
    expect(calls).toBe(1);
    await expect(
      run(null, clockExpression, { now: new Date(instant), timezoneOffset: 60 }),
    ).resolves.toEqual(['2026-01-02T04:04:05.678+01:00', '2026-01-02', '04:04:05.678']);
  });

  it.each(MODES)('accepts a Date from another realm with %s', async (_label, run) => {
    const date = runInNewContext(`new Date(${JSON.stringify(instant)})`) as Date;
    expect(date instanceof Date).toBe(false);
    await expect(run(null, clockExpression, { now: date })).resolves.toEqual(expected);
    await expect(run(null, clockExpression, { now: () => date })).resolves.toEqual(expected);
  });

  it.each(MODES)('copies the Date when the evaluation starts with %s', async (_label, run) => {
    const date = new Date(instant);
    const hooks: EvaluationHooks = {
      trace: () => {
        date.setTime(0);
      },
    };
    await expect(run(null, "1.trace('t').select(now())", { now: date, hooks })).resolves.toEqual([
      expected[0],
    ]);
  });

  it.each(MODES)('rejects what is not a valid Date with %s', async (_label, run) => {
    for (const now of [new Date(Number.NaN), instant, Date.parse(instant), {}, null]) {
      expect(await codeOf(() => run(null, '1', { now } as never))).toBe('eval/invalid-argument');
    }
    for (const result of [new Date(Number.NaN), instant, undefined, Promise.resolve(new Date())]) {
      expect(await codeOf(() => run(null, 'now()', { now: () => result } as never))).toBe(
        'eval/invalid-argument',
      );
    }
    expect(await codeOf(() => run(null, 'now()', { now: new Date('+010000-01-01') }))).toBe(
      'eval/datetime-out-of-range',
    );
  });
});

/** A JavaScript object graph with a cycle, which JSON cannot express ([#186]). */
function cyclic(): Record<string, unknown> {
  const node: Record<string, unknown> = { id: 'loop' };
  node.self = node;
  return node;
}

// docs/architecture.md#security-and-robustness: bounded work.
describe('limits.maxCollectionSize', () => {
  const shared = { leaf: 1 };
  /**
   * Each growth point with an input where it builds three items and every collection before it at
   * most two, so a limit of 3 lets it through and a limit of 2 stops it there.
   */
  const growthPoints: readonly {
    readonly label: string;
    readonly input: unknown;
    readonly expression: string;
    readonly options?: Options;
  }[] = [
    { label: 'a navigation step', input: { list: [1, 2, 3] }, expression: 'list' },
    {
      label: 'a navigation step from several items',
      input: { pair: [{ leaf: [1, 2] }, shared] },
      expression: 'pair.leaf',
    },
    {
      label: 'a step after a type name',
      input: { resourceType: 'Basic', list: [1, 2, 3] },
      expression: 'Basic.list',
    },
    { label: 'children()', input: { a: 1, b: 2, c: 3 }, expression: 'children()' },
    { label: 'descendants()', input: { a: { b: { c: 1 } } }, expression: 'descendants()' },
    {
      label: 'repeat()',
      input: null,
      expression: "'x'.repeat(iif($this.length() < 4, $this & 'x'))",
    },
    { label: 'select()', input: null, expression: '(1 | 2).select(iif($this = 1, 1, 2 | 3))' },
    {
      label: 'trace() with a projection',
      input: null,
      expression: "(1 | 2).trace('t', iif($this = 1, 1, 2 | 3))",
    },
    {
      label: 'resolve()',
      input: null,
      expression: "'Group/1'.resolve()",
      options: { hooks: { resolve: () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } },
    },
    { label: '|', input: null, expression: '1 | 2 | 3' },
    { label: 'union()', input: null, expression: '1.union(2).union(3)' },
    { label: 'combine()', input: null, expression: '1.combine(1).combine(1)' },
  ];

  describe.each(MODES)('with %s', (_label, run) => {
    it.each(growthPoints)('bounds $label', async ({ input, expression, options = {} }) => {
      await expect(
        run(input, expression, { ...options, limits: { maxCollectionSize: 3 } }),
      ).resolves.not.toHaveLength(0);
      const error = await errorOf(() =>
        run(input, expression, { ...options, limits: { maxCollectionSize: 2 } }),
      );
      expect(error).toMatchObject({ code: 'eval/limit-exceeded', expression });
      // The outermost step, the growth point, raised it: an earlier one has a shorter span.
      const span = (error as FhirPathError).span;
      expect(expression.slice(span?.start, span?.end)).toBe(expression);
    });

    // #186: descendants() did not end on a cyclic object graph.
    it('stops descendants() on a cyclic object graph, with the default and a custom limit', async () => {
      expect(await codeOf(() => run(cyclic(), 'descendants()'))).toBe('eval/limit-exceeded');
      for (const expression of ['descendants()', 'self.self.self.descendants().count()']) {
        expect(
          await codeOf(() => run(cyclic(), expression, { limits: { maxCollectionSize: 10 } })),
        ).toBe('eval/limit-exceeded');
      }
    });

    it('stops navigation that multiplies through shared objects', async () => {
      const node: Record<string, unknown> = {};
      node.next = [node, node, node, node];
      const path = `${Array.from({ length: 12 }, () => 'next').join('.')}.count()`;
      expect(await codeOf(() => run(node, path, { limits: { maxCollectionSize: 1_000 } }))).toBe(
        'eval/limit-exceeded',
      );
    });

    it('has a default of 1,000,000 items', async () => {
      const half = Array.from({ length: 500_000 }, (_, index) => index);
      const variables = { half };
      await expect(run(null, '%half.combine(%half).count()', { variables })).resolves.toEqual([
        1_000_000,
      ]);
      expect(await codeOf(() => run(null, '%half.combine(%half).combine(0)', { variables }))).toBe(
        'eval/limit-exceeded',
      );
    });

    it('counts what the evaluation builds, not the input and variables', async () => {
      const input = Array.from({ length: 5 }, (_, index) => index);
      const options = { variables: { many: input }, limits: { maxCollectionSize: 2 } };
      await expect(run(input, 'count() + %many.count()', options)).resolves.toEqual([10]);
      expect(await codeOf(() => run(input, 'select($this)', options))).toBe('eval/limit-exceeded');
    });

    it('bounds the result of a model-aware evaluation', async () => {
      const contained: Record<string, unknown> = { resourceType: 'Patient', id: 'p' };
      contained.contained = [contained];
      for (const model of [r4, r5, r6]) {
        expect(
          await codeOf(() =>
            run(contained, 'descendants()', { model, limits: { maxCollectionSize: 50 } }),
          ),
        ).toBe('eval/limit-exceeded');
      }
    });
  });
});

describe('limits.maxRepeatItems', () => {
  describe.each(MODES)('with %s', (_label, run) => {
    it('stops a projection that makes new values, at the default and a custom limit', async () => {
      const runaway = "'x'.repeat($this & 'x')";
      expect(await codeOf(() => run(null, runaway))).toBe('eval/limit-exceeded');
      await expect(
        run(null, "'x'.repeat(iif($this.length() < 5, $this & 'x')).count()", {
          limits: { maxRepeatItems: 4 },
        }),
      ).resolves.toEqual([4]);
      expect(
        await codeOf(() =>
          run(null, "'x'.repeat(iif($this.length() < 6, $this & 'x'))", {
            limits: { maxRepeatItems: 4 },
          }),
        ),
      ).toBe('eval/limit-exceeded');
    });

    it('lets a lower maxCollectionSize bound repeat() too', async () => {
      const expression = "'x'.repeat(iif($this.length() < 5, $this & 'x')).count()";
      await expect(run(null, expression, { limits: { maxRepeatItems: 100 } })).resolves.toEqual([
        4,
      ]);
      expect(
        await codeOf(() =>
          run(null, expression, { limits: { maxRepeatItems: 100, maxCollectionSize: 3 } }),
        ),
      ).toBe('eval/limit-exceeded');
    });
  });
});

describe('option validation', () => {
  describe.each(MODES)('with %s', (_label, run) => {
    it('rejects limits that are not positive integers, and unknown limits', async () => {
      for (const limits of [
        null,
        [],
        5,
        { maxCollectionSize: 0 },
        { maxCollectionSize: -1 },
        { maxCollectionSize: 1.5 },
        { maxCollectionSize: Number.NaN },
        { maxCollectionSize: Number.POSITIVE_INFINITY },
        { maxCollectionSize: 2 ** 53 },
        { maxCollectionSize: '10' },
        { maxRepeatItems: 0 },
        { maxDepth: 10 },
        { [Symbol('limit')]: 1 },
      ]) {
        expect(await codeOf(() => run(null, '1', { limits } as never)), String(limits)).toBe(
          'eval/invalid-argument',
        );
      }
      await expect(run(null, '1', { limits: {} })).resolves.toEqual([1]);
    });

    it('rejects hooks that are not an object of hooks', async () => {
      for (const hooks of [
        null,
        [],
        'resolve',
        () => undefined,
        { reslove: () => undefined },
        // A warning hook may come later (#232); until then it is rejected, not ignored.
        { warning: () => undefined },
        { [Symbol('resolve')]: () => undefined },
        { resolve: 'Organization/o1' },
        { trace: true },
        { regex: /x/ },
        { terminology: () => true },
        { terminology: { memberOf: true } },
      ]) {
        expect(await codeOf(() => run(null, '1', { hooks } as never))).toBe(
          'eval/invalid-argument',
        );
      }
    });

    it('accepts a terminology provider with other properties, like a unit system', async () => {
      const terminology = { baseUrl: 'https://tx.example.org', memberOf: () => true };
      await expect(
        run(patient, "maritalStatus.memberOf('vs')", { hooks: { terminology } }),
      ).resolves.toEqual([true]);
    });

    it('rejects a hook answer of the wrong type', async () => {
      const cases: readonly (readonly [string, EvaluationHooks])[] = [
        ["conformsTo('p')", { conformsTo: () => 'yes' as never }],
        ["'x'.htmlChecks()", { htmlChecks: () => 1 as never }],
        ["maritalStatus.memberOf('vs')", { terminology: { memberOf: () => 'true' as never } }],
        ['%parent.subsumes(%child)', { terminology: { subsumes: () => 'above' as never } }],
        ["id.matches('x')", { regex: () => ({ test: () => true }) as never }],
      ];
      for (const [expression, hooks] of cases) {
        expect(await codeOf(() => run(patient, expression, { hooks, variables: codings }))).toBe(
          'eval/invalid-argument',
        );
      }
    });
  });
});

// docs/roadmap.md#fhir-versions: hooks know nothing about FHIR versions.
describe.each([
  { label: 'R4', model: r4, typed: false },
  { label: 'R5', model: r5, typed: false },
  { label: 'R6', model: r6, typed: true },
] as const satisfies readonly { label: string; model: ModelProvider; typed: boolean }[])(
  'a resolve hook with the $label model',
  ({ model, typed }) => {
    const alert = { resourceType: 'DeviceAlert', id: 'a1', label: 'SpO2 low' };
    const observation = {
      resourceType: 'Observation',
      id: 'o1',
      status: 'final',
      subject: { reference: 'DeviceAlert/a1' },
    };

    // A DeviceAlert is a resource of R6 only; R4 and R5 navigate it as untyped data.
    const expression = 'subject.resolve().is(FHIR.Resource) | subject.resolve().label';

    it.each(MODES)(
      'types what the hook returns like the input with %s',
      async (_label, run, isAsync) => {
        await expect(
          run(observation, expression, { model, hooks: { resolve: () => alert } }),
        ).resolves.toEqual([typed, 'SpO2 low']);
        for (const [, wrap] of WRAPS) {
          const result = run(observation, expression, {
            model,
            hooks: { resolve: () => wrap(alert) },
          });
          if (isAsync) {
            await expect(result).resolves.toEqual([typed, 'SpO2 low']);
          } else {
            expect(await codeOf(() => result)).toBe('eval/async-in-sync');
          }
        }
      },
    );
  },
);

describe('public async and hook types', () => {
  it('types evaluateAsync() and the new options', () => {
    expectTypeOf(evaluateAsync(null, '1')).toEqualTypeOf<Promise<unknown[]>>();
    expectTypeOf(compile('1').evaluateAsync(null)).toEqualTypeOf<Promise<unknown[]>>();
    expectTypeOf<keyof CompiledExpression>().toEqualTypeOf<
      'expression' | 'evaluate' | 'evaluateAsync'
    >();
    expectTypeOf<EvaluateOptions['hooks']>().toEqualTypeOf<EvaluationHooks | undefined>();
    expectTypeOf<EvaluateOptions['signal']>().toEqualTypeOf<CancellationSignal | undefined>();
    expectTypeOf<EvaluateOptions['concurrency']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<EvaluateOptions['now']>().toEqualTypeOf<Date | (() => Date) | undefined>();
    expectTypeOf<EvaluateOptions['limits']>().toEqualTypeOf<EvaluationLimits | undefined>();
    expectTypeOf<keyof EvaluationLimits>().toEqualTypeOf<'maxRepeatItems' | 'maxCollectionSize'>();
    expectTypeOf<keyof EvaluationHooks>().toEqualTypeOf<
      'resolve' | 'terminology' | 'conformsTo' | 'htmlChecks' | 'regex' | 'trace'
    >();
    expectTypeOf<keyof TerminologyProvider>().toEqualTypeOf<'memberOf' | 'subsumes'>();
    expectTypeOf<HookResult<boolean>>().toEqualTypeOf<boolean | PromiseLike<boolean>>();
    expectTypeOf<SubsumptionOutcome>().toEqualTypeOf<
      'equivalent' | 'subsumes' | 'subsumed-by' | 'not-subsumed'
    >();
    expectTypeOf<Coding>().toExtend<{ readonly code?: string }>();
    expectTypeOf<AbortSignal>().toExtend<CancellationSignal>();
    expectTypeOf<RegExp>().toExtend<Pick<RegexMatcher, 'test'>>();
  });

  it('accepts sync and async hooks in one type', () => {
    const hooks: EvaluationHooks = {
      resolve: async (reference, { signal, resource }) => ({ reference, signal, resource }),
      conformsTo: () => true,
      htmlChecks: () => Promise.resolve(undefined),
      terminology: { subsumes: () => 'equivalent' },
      trace: () => undefined,
    };
    expectTypeOf(hooks).toExtend<EvaluateOptions['hooks']>();
    // @ts-expect-error regex is synchronous
    const asyncRegex: EvaluationHooks = { regex: async () => /x/ };
    // @ts-expect-error a hook answer has its type
    const wrongAnswer: EvaluationHooks = { conformsTo: () => 'yes' };
    // @ts-expect-error there is no such limit
    const unknownLimit: EvaluationLimits = { maxDepth: 1 };
    expect([asyncRegex, wrongAnswer, unknownLimit]).toHaveLength(3);
  });
});
