import { describe, expect, it } from 'vitest';
import { customThenable, hostFunction, testRegistry } from '../../test/support/test-functions.ts';
import { type EvaluateOptions, evaluate, evaluateAsync, type TraceEvent } from '../api/compile.ts';
import { FhirPathError } from '../errors/fhirpath-error.ts';
import { evaluate as evaluatePublic } from '../index.ts';
import { ModelNode } from '../model/model-node.ts';
import { Decimal } from '../values/decimal/decimal.ts';

const patient = {
  resourceType: 'Patient',
  name: [{ given: ['Peter', 'James'] }, { given: ['Jim'] }, { family: 'Windsor' }],
  contained: [
    { resourceType: 'Observation', id: 'o1', status: 'final' },
    { resourceType: 'Observation', id: 'o2', status: 'draft' },
  ],
};

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof FhirPathError ? error.code : `not a FhirPathError: ${String(error)}`;
  }
  return undefined;
}

/** Evaluates with a trace hook that records every event. */
function traced(
  input: unknown,
  expression: string,
  options: EvaluateOptions = {},
): { readonly result: unknown[]; readonly events: TraceEvent[] } {
  const events: TraceEvent[] = [];
  const result = evaluate(input, expression, {
    ...options,
    hooks: { trace: (event) => void events.push(event) },
  });
  return { result, events };
}

// https://hl7.org/fhirpath/N1/#tracename-string-projection-expression-collection
describe('trace(name [, projection])', () => {
  it('returns its input unchanged, with or without a hook', () => {
    // HL7 testTrace1 and testTrace2
    expect(evaluate(patient, "name.given.trace('test').count() = 3")).toEqual([true]);
    expect(evaluate(patient, "name.trace('test', given).count() = 3")).toEqual([true]);
    expect(traced(patient, "name.trace('test', given)").result).toEqual(patient.name);
    expect(evaluate(patient, "name.trace('test')")[0]).toBe(patient.name[0]);
    expect(evaluate(patient, "{}.trace('test')")).toEqual([]);
  });

  it('sends the name, the input as plain values and the span of the call to the hook', () => {
    const { events } = traced(patient, "name.given.trace('given')");
    // The span of the call is the span errors use: the whole invocation, from its target.
    expect(events).toEqual([
      {
        name: 'given',
        values: ['Peter', 'James', 'Jim'],
        span: { start: 0, end: 25, line: 1, column: 1 },
      },
    ]);
    expect(traced(patient, "1 + trace('one').count()").events[0]?.span).toMatchObject({
      start: 4,
      end: 16,
    });
  });

  it('traces the projection evaluated for each item, as in the spec example', () => {
    // https://hl7.org/fhirpath/N1/#tracename-string-projection-expression-collection:
    // contained.where(criteria).trace('unmatched', id).empty(); exists() until empty() (T0041).
    const { result, events } = traced(
      patient,
      "contained.where(status = 'draft').trace('unmatched', id).exists()",
    );
    expect(result).toEqual([true]);
    expect(events.map(({ name, values }) => [name, values])).toEqual([['unmatched', ['o2']]]);
    expect(traced(patient, "name.trace('i', $index)").events[0]?.values).toEqual([0, 1, 2]);
    expect(traced(patient, "name.trace('n', given.count())").events[0]?.values).toEqual([2, 1, 0]);
  });

  it('sends an event for empty input too', () => {
    expect(traced(patient, "missing.trace('none')").events.map((event) => event.values)).toEqual([
      [],
    ]);
    expect(traced(patient, "name.trace('none', missing)").events[0]?.values).toEqual([]);
  });

  it('sends events in evaluation order, including traces inside a projection', () => {
    const { events } = traced(
      patient,
      "name.trace('outer', given.trace('inner')).given.trace('last')",
    );
    expect(events.map(({ name, values }) => [name, values])).toEqual([
      ['inner', ['Peter', 'James']],
      ['inner', ['Jim']],
      ['inner', []],
      ['outer', ['Peter', 'James', 'Jim']],
      ['last', ['Peter', 'James', 'Jim']],
    ]);
  });

  it('converts the values like the result: typed output and exact decimals', () => {
    const typed = traced({ a: { b: 1 } }, "a.trace('a')", { output: 'typed' });
    expect(typed.events[0]?.values[0]).toBeInstanceOf(ModelNode);
    expect(traced(null, "1.50.trace('d')", { decimalOutput: 'string' }).events[0]?.values).toEqual([
      '1.50',
    ]);
    expect(
      traced(null, "1.50.trace('d')", { output: 'typed' }).events[0]?.values[0],
    ).toBeInstanceOf(Decimal);
    expect(traced(null, "1.50.trace('d')").events[0]?.values).toEqual([1.5]);
  });

  it('reads the name with the focus of the call, as a single String', () => {
    expect(traced({ label: 'from data' }, 'trace(label)').events[0]?.name).toBe('from data');
    expect(traced(patient, "trace('' & 'x')").events[0]?.name).toBe('x');
    // docs/spec-notes.md#trace-names-and-projections: empty traces under '', and still returns input.
    const empty = traced(patient, 'name.trace({}).count()');
    expect(empty.result).toEqual([3]);
    expect(empty.events[0]?.name).toBe('');
  });

  it.each([
    ["trace('a' | 'b')", 'eval/singleton-expected'],
    ['trace(1)', 'eval/type-mismatch'],
    ['trace(true)', 'eval/type-mismatch'],
  ])('raises an error for the name in %s', (expression, code) => {
    expect(codeOf(() => evaluate(patient, expression))).toBe(code);
  });

  it('evaluates the projection without a hook too, so a hook never changes an error', () => {
    expect(codeOf(() => evaluate(patient, "name.trace('x', given + 1)"))).toBe(
      'eval/singleton-expected',
    );
    expect(codeOf(() => traced(patient, "name.trace('x', given + 1)"))).toBe(
      'eval/singleton-expected',
    );
  });

  it('calls a hook method with its object as this', () => {
    const names: string[] = [];
    class Log {
      readonly #names = names;
      trace(event: TraceEvent): void {
        this.#names.push(event.name);
      }
    }
    evaluate(patient, "trace('a').trace('b')", { hooks: new Log() });
    expect(names).toEqual(['a', 'b']);
  });

  it('lets an error from the hook end the evaluation', () => {
    const failure = new Error('log full');
    const hooks = {
      trace(): void {
        throw failure;
      },
    };
    expect(() => evaluate(patient, "trace('a')", { hooks })).toThrow(failure);
  });

  it.each([[{ hooks: 'x' }], [{ hooks: null }], [{ hooks: { trace: 'x' } }]])(
    'raises eval/invalid-argument for the option %j',
    (options) => {
      expect(codeOf(() => evaluate(patient, '1', options as never))).toBe('eval/invalid-argument');
    },
  );

  it('accepts hooks without a trace hook', () => {
    expect(evaluate(patient, "name.trace('a').count()", { hooks: {} })).toEqual([3]);
  });

  it('is available through the public API, which has no hooks', () => {
    expect(evaluatePublic(patient, "name.given.trace('given')")).toEqual(['Peter', 'James', 'Jim']);
  });

  it('raises semantic/wrong-arity without a name or with more than two arguments', () => {
    expect(codeOf(() => evaluate(patient, 'trace()'))).toBe('semantic/wrong-arity');
    expect(codeOf(() => evaluate(patient, "trace('a', given, 1)"))).toBe('semantic/wrong-arity');
  });
});

// docs/guides/testing.md: lambda and host functions run in sync and async mode.
describe('trace() in sync and async mode', () => {
  const functions = testRegistry(hostFunction('later', (items) => customThenable(items)));

  it('evaluates an async projection in async mode', async () => {
    const events: TraceEvent[] = [];
    const result = await evaluateAsync(patient, "name.trace('n', given.later())", {
      functions,
      hooks: { trace: (event) => void events.push(event) },
    });
    expect(result).toEqual(patient.name);
    expect(events.map((event) => event.values)).toEqual([['Peter', 'James', 'Jim']]);
    expect(codeOf(() => evaluate(patient, "name.trace('n', given.later())", { functions }))).toBe(
      'eval/async-in-sync',
    );
  });

  it('waits for a hook that returns a thenable, in order, in async mode', async () => {
    const order: string[] = [];
    const hooks = {
      trace: (event: TraceEvent) => {
        order.push(`start ${event.name}`);
        return customThenable(undefined).then(() => void order.push(`end ${event.name}`));
      },
    };
    const result = await evaluateAsync(patient, "trace('a').name.trace('b').count()", { hooks });
    expect(result).toEqual([3]);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('raises eval/async-in-sync for a hook that returns a thenable in sync mode', () => {
    const hooks = { trace: () => customThenable(undefined) };
    expect(codeOf(() => evaluate(patient, "trace('a')", { hooks }))).toBe('eval/async-in-sync');
  });

  it('rejects when an async hook rejects', async () => {
    const failure = new Error('log unavailable');
    const hooks = { trace: () => Promise.reject(failure) };
    await expect(evaluateAsync(patient, "trace('a')", { hooks })).rejects.toBe(failure);
  });
});

// https://hl7.org/fhirpath/N1/#current-date-and-time-functions, ADR-0012
describe('now(), today() and timeOfDay()', () => {
  const instant = new Date('2026-11-08T23:30:15.250Z');

  it('are computed in UTC by default', () => {
    expect(evaluate(null, 'now() | today() | timeOfDay()', { now: instant })).toEqual([
      '2026-11-08T23:30:15.250Z',
      '2026-11-08',
      '23:30:15.250',
    ]);
  });

  it.each<[number, string[]]>([
    [60, ['2026-11-09T00:30:15.250+01:00', '2026-11-09', '00:30:15.250']],
    [-300, ['2026-11-08T18:30:15.250-05:00', '2026-11-08', '18:30:15.250']],
    [330, ['2026-11-09T05:00:15.250+05:30', '2026-11-09', '05:00:15.250']],
  ])('follow the timezoneOffset %i', (timezoneOffset, expected) => {
    expect(
      evaluate(null, 'now() | today() | timeOfDay()', { now: instant, timezoneOffset }),
    ).toEqual(expected);
  });

  it("use the host's offset at the evaluation's instant with timezoneOffset 'local'", () => {
    const offset = 0 - instant.getTimezoneOffset();
    expect(evaluate(null, 'now()', { now: instant, timezoneOffset: 'local' })).toEqual(
      evaluate(null, 'now()', { now: instant, timezoneOffset: offset }),
    );
  });

  it('give one value per evaluation, reading the clock once', () => {
    let calls = 0;
    const clock = (): Date => new Date(Date.UTC(2026, 10, 8, 12, 0, 0, calls++));
    expect(
      evaluate(null, 'now() = now() and today() = today() and timeOfDay() = timeOfDay()', {
        now: clock,
      }),
    ).toEqual([true]);
    expect(calls).toBe(1);
    expect(evaluate(null, 'now()', { now: clock })).toEqual(['2026-11-08T12:00:00.001Z']);
    expect(calls).toBe(2);
  });

  it('give the same value across lambdas and the input items of one evaluation', () => {
    let calls = 0;
    const clock = (): Date => new Date(Date.UTC(2026, 10, 8, 12, 0, 0, calls++));
    expect(evaluate(patient, 'name.where(now() = now()).count()', { now: clock })).toEqual([3]);
    expect(evaluate(patient, 'name.now()', { now: clock })).toEqual(['2026-11-08T12:00:00.001Z']);
  });

  it('are singletons of the System types DateTime, Date and Time', () => {
    const options = { now: instant };
    expect(evaluate(null, 'now() is DateTime', options)).toEqual([true]);
    expect(evaluate(null, 'today() is Date', options)).toEqual([true]);
    expect(evaluate(null, 'timeOfDay() is Time', options)).toEqual([true]);
    // HL7 testDateTimeGreaterThanDate2: the same day at different precisions is empty.
    expect(evaluate(null, 'now() > today()', options)).toEqual([]);
    expect(evaluate(null, 'now() > @2026-11-07', options)).toEqual([true]);
    expect(evaluate(null, 'today() = @2026-11-08', options)).toEqual([true]);
    expect(evaluate(null, 'now() = @2026-11-08T23:30:15.250Z', options)).toEqual([true]);
    expect(evaluate(null, 'timeOfDay() = @T23:30:15.250', options)).toEqual([true]);
  });

  it('work in async mode', async () => {
    expect(await evaluateAsync(null, 'today()', { now: instant })).toEqual(['2026-11-08']);
  });

  it('are available through the public API, in UTC or the given offset', () => {
    expect(evaluatePublic(null, 'today() = today()')).toEqual([true]);
    expect(evaluatePublic(null, 'now() is DateTime', { timezoneOffset: 120 })).toEqual([true]);
  });

  it.each(['now(1)', 'today(1)', 'timeOfDay(1)'])(
    '%s raises semantic/wrong-arity',
    (expression) => {
      expect(codeOf(() => evaluate(null, expression))).toBe('semantic/wrong-arity');
    },
  );
});
