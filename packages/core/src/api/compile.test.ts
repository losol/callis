import { describe, expect, it } from 'vitest';
import { stubModel } from '../../test/support/stub-model.ts';
import { defineFunction } from '../functions/define.ts';
import { createRegistry } from '../functions/registry.ts';
import type { Collection } from '../runtime/collection.ts';
import type { EvalContext } from '../runtime/context.ts';
import { minimalUnitSystem } from '../values/quantity/unit-system.ts';
import { compile, evaluate, evaluateAsync } from './compile.ts';

/** A registry with `probe()`, which hands the evaluation context to the test. */
function probing(seen: (ctx: EvalContext) => Collection) {
  return createRegistry().extend([
    defineFunction({ name: 'probe', params: [], impl: (call) => seen(call.ctx) }),
  ]);
}

describe('compile', () => {
  it('keeps the expression text and the AST', () => {
    const compiled = compile('Patient.name');
    expect(compiled.expression).toBe('Patient.name');
    expect(compiled.ast).toMatchObject({ kind: 'Member', name: 'name' });
    expect(Object.isFrozen(compiled)).toBe(true);
  });

  it('raises syntax errors at compile time', () => {
    expect(() => compile('Patient.')).toThrow(
      expect.objectContaining({ name: 'FhirPathSyntaxError' }),
    );
  });

  it('resolves type names against the model given at compile time', () => {
    const input = { resourceType: 'Patient' };
    // Without a model, an unqualified unknown name is a resource name; with one, it is unknown.
    expect(evaluate(input, 'Patient is Pateint')).toEqual([false]);
    expect(() => evaluate(input, 'Patient is Pateint', { model: stubModel })).toThrow(
      expect.objectContaining({ code: 'eval/unknown-type' }),
    );
  });

  it('can be evaluated many times with different inputs', () => {
    const compiled = compile('id');
    expect(compiled.evaluate({ id: 'a' })).toEqual(['a']);
    expect(compiled.evaluate({ id: 'b' })).toEqual(['b']);
  });
});

describe('the evaluation context', () => {
  it('passes the model and unit system of the compile options', () => {
    // A copy is a different object with the same behaviour, so identity shows it was passed on.
    const units = { ...minimalUnitSystem };
    const seen: EvalContext[] = [];
    const functions = probing((ctx) => {
      seen.push(ctx);
      return [];
    });
    evaluate({}, 'probe()', { functions, model: stubModel, units });
    expect(seen[0]?.model).toBe(stubModel);
    expect(seen[0]?.units).toBe(units);
    expect(seen[0]?.isAsync).toBe(false);
  });

  // ADR-0012: UTC by default; 'local' uses the host's offset at the evaluation's instant.
  it('resolves the timezone offset: 0 by default, a number, or the local offset', () => {
    const offsets: number[] = [];
    const functions = probing((ctx) => {
      offsets.push(ctx.timezoneOffset);
      return [];
    });
    const now = new Date('2024-07-01T12:00:00Z');
    evaluate({}, 'probe()', { functions });
    evaluate({}, 'probe()', { functions, timezoneOffset: 120 });
    evaluate({}, 'probe()', { functions, timezoneOffset: 'local', now });
    expect(offsets).toEqual([0, 120, 0 - now.getTimezoneOffset()]);
  });

  it('rejects an offset outside ±14:00', () => {
    expect(() => evaluate({}, '1', { timezoneOffset: 15 * 60 })).toThrow(
      expect.objectContaining({ code: 'eval/invalid-argument' }),
    );
  });

  it('takes the now snapshot once, from the now option, in the evaluation offset', () => {
    let calls = 0;
    const snapshots: string[] = [];
    const functions = probing((ctx) => {
      snapshots.push(ctx.now().now.toString(), ctx.now().today.toString());
      return [];
    });
    const now = () => {
      calls++;
      return new Date('2024-07-01T23:30:00Z');
    };
    evaluate({}, 'probe()', { functions, now, timezoneOffset: 60 });
    expect(calls).toBe(1);
    expect(snapshots).toEqual(['2024-07-02T00:30:00.000+01:00', '2024-07-02']);
  });

  it('does not read the clock unless something needs the time', () => {
    let calls = 0;
    evaluate({}, '1', {
      now: () => {
        calls++;
        return new Date();
      },
    });
    expect(calls).toBe(0);
  });

  it.each([
    { now: 'today' },
    { variables: 'x' },
    { signal: 'no' },
    { signal: {} },
    { signal: { aborted: 'yes' } },
    { concurrency: 0 },
    { concurrency: 1.5 },
    { concurrency: '2' },
    { concurrency: -1 },
    { concurrency: Number.NaN },
    { hooks: 1 },
    { hooks: { resolve: 1 } },
    { hooks: { terminology: 'server' } },
  ])('raises eval/invalid-argument for the option %j', (options) => {
    expect(() => evaluate({}, '1', options as never)).toThrow(
      expect.objectContaining({ code: 'eval/invalid-argument' }),
    );
  });

  // docs/tasks/T0021-hooks-async.md#sync-and-async
  it('passes the signal, the concurrency and the bound hooks on', () => {
    const seen: EvalContext[] = [];
    const functions = probing((ctx) => {
      seen.push(ctx);
      return [];
    });
    const signal = { aborted: false };
    const hooks = { conformsTo: () => true };
    evaluate({}, 'probe()', { functions });
    evaluate({}, 'probe()', { functions, signal, hooks, concurrency: 3 });
    evaluate({}, 'probe()', { functions, concurrency: Number.POSITIVE_INFINITY });
    expect(seen.map((ctx) => ctx.concurrency)).toEqual([8, 3, Number.POSITIVE_INFINITY]);
    expect(seen[0]?.signal).toBeUndefined();
    expect(seen[0]?.hooks.conformsTo).toBeUndefined();
    expect(seen[1]?.signal).toBe(signal);
    expect(typeof seen[1]?.hooks.conformsTo).toBe('function');
    expect(seen[1]?.hooks.resolve).toBeUndefined();
  });

  it('evaluates nothing for an aborted signal, in sync and async mode', async () => {
    let calls = 0;
    const functions = probing(() => {
      calls++;
      return [];
    });
    const signal = { aborted: true, reason: 'stop' };
    expect(() => evaluate({}, 'probe()', { functions, signal })).toThrow(
      expect.objectContaining({ code: 'eval/aborted', cause: 'stop' }),
    );
    const pending = evaluateAsync({}, 'probe()', { functions, signal });
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).rejects.toMatchObject({ code: 'eval/aborted', cause: 'stop' });
    expect(calls).toBe(0);
  });

  it('marks async evaluations', async () => {
    const modes: boolean[] = [];
    const functions = probing((ctx) => {
      modes.push(ctx.isAsync);
      return [];
    });
    await evaluateAsync({}, 'probe()', { functions });
    expect(modes).toEqual([true]);
  });
});

describe('evaluate and evaluateAsync', () => {
  it('give plain output by default and typed output on request', async () => {
    expect(evaluate({}, '1.50')).toEqual([1.5]);
    expect(evaluate({}, '1.50', { decimalOutput: 'string' })).toEqual(['1.50']);
    const [typed] = await evaluateAsync({}, '1.50', { output: 'typed' });
    expect(String(typed)).toBe('1.50');
  });
});
