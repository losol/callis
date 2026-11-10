import { describe, expect, it } from 'vitest';
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import type { CancellationSignal } from './cancellation.ts';
import { bindHooks, type EvaluationHooks, type HookBinding, NO_HOOKS } from './hooks.ts';

// docs/tasks/T0021-hooks-async.md#host-hooks, docs/adr/0004-sync-core-async-path.md
const sync: HookBinding = { isAsync: false, signal: undefined };
const async: HookBinding = { isAsync: true, signal: undefined };
const context = { signal: undefined };

function thenable<T>(value: T): PromiseLike<T> {
  return {
    // biome-ignore lint/suspicious/noThenProperty: the test needs a custom thenable.
    then: (onFulfilled, onRejected) => Promise.resolve(value).then(onFulfilled, onRejected),
  };
}

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof FhirPathEvaluationError ? error.code : `not a FhirPathError`;
  }
  return undefined;
}

describe('bindHooks', () => {
  it('gives no hooks for no hooks option', () => {
    expect(bindHooks(undefined, sync)).toBe(NO_HOOKS);
    expect(bindHooks({}, sync)).toEqual(NO_HOOKS);
    expect(Object.isFrozen(bindHooks({}, sync))).toBe(true);
  });

  it.each<[string, unknown]>([
    ['hooks that are not an object', 'resolve'],
    ['hooks that are null', null],
    ['a resolve hook that is not a function', { resolve: true }],
    ['a conformsTo hook that is not a function', { conformsTo: 'yes' }],
    ['an htmlChecks hook that is not a function', { htmlChecks: {} }],
    ['a regex hook that is not a function', { regex: /a/ }],
    ['a trace hook that is not a function', { trace: 1 }],
    ['a terminology provider that is not an object', { terminology: () => true }],
    ['a memberOf member that is not a function', { terminology: { memberOf: 1 } }],
    ['a subsumes member that is not a function', { terminology: { subsumes: 'x' } }],
  ])('raises eval/invalid-argument for %s', (_label, hooks) => {
    expect(codeOf(() => bindHooks(hooks as EvaluationHooks, sync))).toBe('eval/invalid-argument');
  });

  it('calls a hook with the hooks object as this, and a terminology member with the provider', () => {
    const owners: unknown[] = [];
    const hooks: EvaluationHooks = {
      resolve() {
        owners.push(this);
        return { resourceType: 'Patient' };
      },
      terminology: {
        memberOf() {
          owners.push(this);
          return true;
        },
      },
    };
    const bound = bindHooks(hooks, sync);
    expect(bound.resolve?.('Patient/1', { signal: undefined, resource: undefined })).toEqual({
      resourceType: 'Patient',
    });
    expect(bound.memberOf?.({ kind: 'code', codings: [], value: 'a' }, 'vs', context)).toBe(true);
    expect(owners).toEqual([hooks, hooks.terminology]);
  });

  it('reads undefined and null as no answer, and keeps booleans', () => {
    const answers: unknown[] = [undefined, null, true, false];
    const bound = bindHooks({ conformsTo: () => answers.shift() as boolean }, sync);
    const ask = () => bound.conformsTo?.({}, 'p', context);
    expect([ask(), ask(), ask(), ask()]).toEqual([undefined, undefined, true, false]);
  });

  it.each<[string, unknown]>([
    ['a string', 'true'],
    ['a number', 1],
    ['an object', {}],
  ])('rejects %s from a boolean hook with eval/invalid-argument', (_label, answer) => {
    const bound = bindHooks({ htmlChecks: () => answer as boolean }, sync);
    expect(codeOf(() => bound.htmlChecks?.('<p/>', { ...context, kind: 'string' }))).toBe(
      'eval/invalid-argument',
    );
  });

  it('accepts the four subsumption outcomes and no answer, and nothing else', () => {
    const answers: unknown[] = [
      'equivalent',
      'subsumes',
      'subsumed-by',
      'not-subsumed',
      null,
      'yes',
    ];
    const bound = bindHooks({ terminology: { subsumes: () => answers.shift() as never } }, sync);
    const ask = (): unknown => bound.subsumes?.({ code: 'a' }, { code: 'b' }, context);
    expect([ask(), ask(), ask(), ask(), ask()]).toEqual([
      'equivalent',
      'subsumes',
      'subsumed-by',
      'not-subsumed',
      undefined,
    ]);
    expect(codeOf(ask)).toBe('eval/invalid-argument');
  });

  it('passes a resolve result through as it is', () => {
    const resource = { resourceType: 'Patient' };
    const bound = bindHooks({ resolve: () => resource }, sync);
    expect(bound.resolve?.('Patient/1', { signal: undefined, resource: undefined })).toBe(resource);
  });

  it('raises eval/async-in-sync for a thenable in sync mode, and adopts it in async mode', async () => {
    const hooks: EvaluationHooks = {
      resolve: () => thenable({ resourceType: 'Patient' }),
      conformsTo: () => Promise.resolve(true),
    };
    const inSync = bindHooks(hooks, sync);
    expect(
      codeOf(() => inSync.resolve?.('Patient/1', { signal: undefined, resource: undefined })),
    ).toBe('eval/async-in-sync');
    expect(codeOf(() => inSync.conformsTo?.({}, 'p', context))).toBe('eval/async-in-sync');
    const inAsync = bindHooks(hooks, async);
    const resolved = inAsync.resolve?.('Patient/1', { signal: undefined, resource: undefined });
    expect(resolved).toBeInstanceOf(Promise);
    await expect(resolved).resolves.toEqual({ resourceType: 'Patient' });
    await expect(inAsync.conformsTo?.({}, 'p', context)).resolves.toBe(true);
  });

  it('checks the answer of a promise too', async () => {
    const bound = bindHooks({ htmlChecks: () => Promise.resolve('no' as never) }, async);
    await expect(bound.htmlChecks?.('<p/>', { ...context, kind: 'xhtml' })).rejects.toMatchObject({
      code: 'eval/invalid-argument',
    });
  });

  it('lets an error the hook throws, or rejects with, through unchanged', async () => {
    const failure = new RangeError('host failed');
    const bound = bindHooks(
      {
        conformsTo: () => {
          throw failure;
        },
        htmlChecks: () => Promise.reject(failure),
      },
      async,
    );
    expect(() => bound.conformsTo?.({}, 'p', context)).toThrow(failure);
    await expect(bound.htmlChecks?.('<p/>', { ...context, kind: 'xhtml' })).rejects.toBe(failure);
  });

  // docs/tasks/T0021-hooks-async.md#sync-and-async: the signal before and after each call.
  it('does not call a hook once the signal is aborted', () => {
    let calls = 0;
    const signal: CancellationSignal = { aborted: true, reason: new Error('stop') };
    const bound = bindHooks({ conformsTo: () => (calls++, true) }, { isAsync: false, signal });
    const error = (() => {
      try {
        bound.conformsTo?.({}, 'p', { signal });
      } catch (thrown) {
        return thrown;
      }
      return undefined;
    })();
    expect(error).toMatchObject({ code: 'eval/aborted', cause: signal.reason });
    expect(calls).toBe(0);
  });

  it('rejects a result that arrived after the signal was aborted', async () => {
    const signal = { aborted: false };
    const bound = bindHooks({ conformsTo: () => Promise.resolve(true) }, { isAsync: true, signal });
    const pending = bound.conformsTo?.({}, 'p', { signal });
    signal.aborted = true;
    await expect(pending).rejects.toMatchObject({ code: 'eval/aborted' });
  });

  it('binds the regex hook synchronously and checks the matcher', () => {
    const bound = bindHooks(
      {
        regex: (pattern, flags) => {
          const regex = new RegExp(pattern, flags);
          return {
            test: (text) => regex.test(text),
            matchAll: (text) => text.matchAll(new RegExp(pattern, `g${flags}`)),
          };
        },
      },
      async,
    );
    expect(bound.regex?.('a', 'su').test('cat')).toBe(true);
    const broken = bindHooks({ regex: () => Promise.resolve() as never }, async);
    expect(codeOf(() => broken.regex?.('a', 'su'))).toBe('eval/invalid-argument');
  });
});
