import { describe, expect, it } from 'vitest';
import { compile, evaluate, evaluateAsync } from '../src/api/compile.ts';
import { ModelNode } from '../src/model/model-node.ts';
import { BINARY_OPERATIONS } from '../src/runtime/operators.ts';
import { Decimal, MAX_DECIMAL_DIGITS } from '../src/values/decimal/decimal.ts';
import { minimalUnitSystem } from '../src/values/quantity/unit-system.ts';
import { hostFunction, testRegistry } from './support/test-functions.ts';

function run(expression: string, input: unknown = {}): unknown[] {
  return evaluate(input, expression, { decimalOutput: 'string' });
}

// N1 §6.1: https://hl7.org/fhirpath/N1/#equality
// Temporal seconds and milliseconds share one precision; N1 §6.1.1/6.1.2 examples.
describe('equality and equivalence operators', () => {
  it.each([
    ['@2012', '@2012', true, true],
    ['@2012', '@2013', false, false],
    ['@2012-01', '@2012', undefined, false],
    ['@2012-01-01T10:30', '@2012-01-01T10:30', true, true],
    ['@2012-01-01T10:30', '@2012-01-01T10:31', false, false],
    ['@2012-01-01T10:30:31', '@2012-01-01T10:30', undefined, false],
    ['@2012-01-01T10:30:31.0', '@2012-01-01T10:30:31', true, true],
    ['@2012-01-01T10:30:31.1', '@2012-01-01T10:30:31', false, false],
    ['1 second', "1 's'", true, true],
    // 3.0.0 clarification, testEquality36 supersedes N1's false.
    ['1 year', "1 'a'", undefined, true],
    ['1', '1.0', true, true],
    ['1.2', '1.20', true, true],
    ['1.2', '1.23', false, true],
    ["'a b'", "'A\\tB'", false, true],
    ['true', 'true', true, true],
    ['true', 'false', false, false],
    ['1', "'1'", false, false],
    ['{}', '{}', undefined, true],
    ['{}', '1', undefined, false],
    ['1', '{}', undefined, false],
  ] as const)('%s compared to %s', (left, right, equal, equivalent) => {
    for (const [op, expected] of [
      ['=', equal],
      ['!=', equal === undefined ? undefined : !equal],
      ['~', equivalent],
      ['!~', !equivalent],
    ] as const) {
      expect(run(`${left} ${op} ${right}`), op).toEqual(expected === undefined ? [] : [expected]);
    }
  });

  it.each([
    ['a = b', false],
    ['a ~ b', true],
    ['a != b', true],
    ['a !~ b', false],
    ['a = c', true],
    ['a = d', false],
    ['a ~ d', false],
    ['objects = copies', true],
    ['objects ~ copies', true],
  ])('compares whole collections with %s', (expression, expected) => {
    expect(
      run(String(expression), {
        a: [1, 2, 1],
        b: [1, 1, 2],
        c: [1, 2, 1],
        d: [1, 2],
        objects: [{ x: [1, 2] }],
        copies: [{ x: [1, 2] }],
      }),
    ).toEqual([expected]);
  });
});

// N1 §6.1.1 timezone examples; ADR-0012 for the evaluation's default offset.
describe('timezone comparison', () => {
  it.each([
    ['>', '01:15:00.0-05:00', false],
    ['<', '01:15:00.0-05:00', true],
    ['=', '01:15:00.0-05:00', false],
    ['=', '00:30:00.0-05:00', true],
  ])('%s respects the offset', (op, right, expected) => {
    expect(run(`@2017-11-05T01:30:00.0-04:00 ${op} @2017-11-05T${right}`)).toEqual([expected]);
  });
  it('passes the default offset to comparison kernels', () => {
    const compiled = compile('@2020-01-01T12:00 = @2020-01-01T10:00Z');
    expect(compiled.evaluate({}, { timezoneOffset: 120 })).toEqual([true]);
    expect(compiled.evaluate({})).toEqual([false]);
  });
});

// Every operand pair in N1 §6.2.1–6.2.4: https://hl7.org/fhirpath/N1/#comparison
// N1 has incorrect numeric/String result comments in <= and >=; see spec notes.
describe('ordering operators', () => {
  it.each([
    ['10', '5', 1],
    ['10', '5.0', 1],
    ["'abc'", "'ABC'", 1],
    ['@2018-03-01', '@2018-01-01', 1],
    ['@2018-03', '@2018-03-01', undefined],
    ['@2018-03-01T10:30:00', '@2018-03-01T10:00:00', 1],
    ['@2018-03-01T10', '@2018-03-01T10:30', undefined],
    ['@2018-03-01T10:30:00', '@2018-03-01T10:30:00.0', 0],
    ['@T10:30:00', '@T10:00:00', 1],
    ['@T10', '@T10:30', undefined],
    ['@T10:30:00', '@T10:30:00.0', 0],
    ['10 seconds', "1 's'", 1],
    ['1 year', "1 'a'", undefined],
    ["'😀'", "'\uE000'", 1],
  ] as const)('%s versus %s', (left, right, order) => {
    for (const op of ['<', '>', '<=', '>='] as const) {
      const expected =
        order === undefined
          ? []
          : [{ '<': order < 0, '>': order > 0, '<=': order <= 0, '>=': order >= 0 }[op]];
      expect(run(`${left} ${op} ${right}`), op).toEqual(expected);
    }
  });
});

// N1 §6.6/6.7 examples: https://hl7.org/fhirpath/N1/#math
// https://hl7.org/fhirpath/N1/#datetime-arithmetic
// UCUM dimension examples live in packages/ucum/test/operator-integration.test.ts.
describe('arithmetic operators', () => {
  it.each([
    ['1 + 2', 3],
    ['2 - 3', -1],
    ['2 * 3', 6],
    ['4 / 2', '2'],
    ['1 / 2', '0.5'],
    ['0.1 + 0.2', '0.3'],
    ['1.20 + 2', '3.20'],
    ['2 - 1.20', '0.80'],
    ['1.2 * 1.8', '2.16'],
    ['5 div 2', 2],
    ['5.5 div 0.7', '7'],
    ['5 mod 2', 1],
    ['5.5 mod 0.7', '0.6'],
    ['-5 div 2', -2],
    ['5 div -2', -2],
    ['-5 mod 2', -1],
    ['5 mod -2', 1],
    ['-5.5 div 2', '-2'],
    ['-5.5 mod 2', '-1.5'],
    ['1 / 3', '0.3333333333333333333333333333'],
    ["'ABC' + 'DEF'", 'ABCDEF'],
    ["'ABC' & 'DEF'", 'ABCDEF'],
    ["'ABC' & {} & 'DEF'", 'ABCDEF'],
    ['{} & {}', ''],
    ["{} & 'x'", 'x'],
    ["'x' & {}", 'x'],
    ['@2014 + 24 months', '2016'],
    ['@2019-03-01 + 24 months', '2021-03-01'],
    ['@2014 + 23 months', '2015'],
    ['@2016 + 365 days', '2017'],
    ['@2014 - 24 months', '2012'],
    ['@2019-03-01 - 24 months', '2017-03-01'],
    ['@2020-01-31 + 1 month', '2020-02-29'],
    ['@2020-02-29 + 1 year', '2021-02-28'],
    ['@2020-03-31 - 1 month', '2020-02-29'],
    ['@1973-12-25 + 7.7 days', '1974-01-01'],
    ['@2014 + 11 months', '2014'],
    ['@2020-01-01 + 1 week', '2020-01-08'],
    ["@2020-01-01 + 1 'wk'", '2020-01-08'],
    ["@2020-01-01 - 1 'd'", '2019-12-31'],
    ["@2020-01-01T00:00:00.000 + 0.1 's'", '2020-01-01T00:00:00.100'],
    ['@T23:30 + 1 hour', '00:30'],
    ['@T00:30 - 1 hour', '23:30'],
    ['@2020-01-01T23:30+02:00 + 1 hour', '2020-01-02T00:30+02:00'],
    ['2 + 3 * 4', 14],
    ['(2 + 3) * 4', 20],
    ['10 - 3 - 2', 5],
    ['20 / 2 / 5', '2'],
  ] as const)('%s', (expression, expected) => expect(run(expression)).toEqual([expected]));

  it.each([
    '12 / 0',
    '5 div 0',
    '5 mod 0',
    '1.0 / 0',
    '1.0 div 0',
    '1.0 mod 0',
    '2147483647 + 1',
    '-2147483648 - 1',
    '2147483647 * 2',
    '-2147483648 div -1',
    "'ABC' + {} + 'DEF'",
  ])('returns empty for %s', (expression) => expect(run(expression)).toEqual([]));

  it('preserves Integer and Decimal result types, including zero normalization', () => {
    for (const op of ['+', '-', '*', 'div', 'mod']) {
      expect(typeof evaluate({}, `4 ${op} 2`, { output: 'typed' })[0]).toBe('number');
      expect(evaluate({}, `4.0 ${op} 2`, { output: 'typed' })[0]).toBeInstanceOf(Decimal);
    }
    expect(evaluate({}, '4 / 2', { output: 'typed' })[0]).toBeInstanceOf(Decimal);
    expect(Object.is(evaluate({}, '-4 mod 2')[0], -0)).toBe(false);
    expect(run('2147483647 + 1.0')).toEqual(['2147483648.0']);
    expect(run('-2147483648 mod -1')).toEqual([0]);
  });

  // T0004 bounds: supported operands whose result exceeds coefficient or scale size give empty.
  it('propagates Decimal coefficient/scale overflow without throwing', () => {
    const huge = Decimal.of(10n ** BigInt(MAX_DECIMAL_DIGITS - 1));
    const tiny = Decimal.of(1n, MAX_DECIMAL_DIGITS);
    const ctx = { model: undefined, units: minimalUnitSystem, timezoneOffset: 0 };
    expect(BINARY_OPERATIONS['+']([huge], [tiny], ctx)).toEqual([]);
    expect(BINARY_OPERATIONS['-']([huge], [tiny], ctx)).toEqual([]);
    expect(BINARY_OPERATIONS['*']([tiny], [tiny], ctx)).toEqual([]);
    expect(BINARY_OPERATIONS['/']([huge], [tiny], ctx)).toEqual([]);
    expect(BINARY_OPERATIONS.div([huge], [tiny], ctx)).toEqual([]);
  });
});

// N1 §6.4: https://hl7.org/fhirpath/N1/#collections-2
// Unknown equality does not establish membership or duplication; see spec notes.
describe('collection operators', () => {
  it.each([
    ['1 in (1 | 2)', [true]],
    ['3 in (1 | 2)', [false]],
    ['{} in 1', []],
    ['1 in {}', [false]],
    ['{} in {}', []],
    ['(1 | 2) contains 1', [true]],
    ['{} contains 1', [false]],
    ['1 contains {}', []],
    ['{} contains {}', []],
    ['1 | 1.0 | 2 | 2', [1, 2]],
    ['1 | {}', [1]],
    ['{} | 1', [1]],
    ['{} | {}', []],
    ["'A' | 'a'", ['A', 'a']],
    ['@2020 in @2020-01', [false]],
    ['(@2020 | @2020-01)[1] = @2020-01', [true]],
    ['(@2020-01 | @2020) contains @2020', [true]],
  ] as const)('%s', (expression, expected) => expect(run(expression)).toEqual(expected));

  it('removes duplicates within either operand, including complex input values', () => {
    expect(run('a | b', { a: [1, 1, 2], b: [2, 3, 3] })).toEqual([1, 2, 3]);
    expect(run('a | {}', { a: [1, 1] })).toEqual([1]);
    expect(run('a | b', { a: [{ x: 1 }, { x: 1 }], b: [{ x: 2 }, { x: 1 }] })).toEqual([
      { x: 1 },
      { x: 2 },
    ]);
    expect(run('a in b', { a: { x: 1 }, b: [{ x: 2 }, { x: 1 }] })).toEqual([true]);
    expect(run('a | b', { a: ['x', 'x'], b: [] })).toEqual(['x']);
  });

  it('retains input date provenance through union, but computed strings have none', () => {
    const input = { birthDate: '1974-12-25' };
    expect(run('(birthDate | {}) = @1974-12-25', input)).toEqual([true]);
    expect(run('birthDate in @1974-12-25', input)).toEqual([true]);
    expect(run('@1974-12-25 contains birthDate', input)).toEqual([true]);
    expect(run("(birthDate & '') = @1974-12-25", input)).toEqual([false]);
    expect(run("(birthDate + '') = @1974-12-25", input)).toEqual([false]);
    expect(run('birthDate < @2000', input)).toEqual([true]);
    expect(run('birthDate', input)).toEqual(['1974-12-25']);
    const [node] = evaluate(input, 'birthDate | {}', { output: 'typed' });
    expect(node).toBeInstanceOf(ModelNode);
  });
});

// N1 §4.5/6: empty propagation and the two singleton error codes (#67).
describe('operand contracts', () => {
  const singletonOps = ['+', '-', '*', '/', 'div', 'mod', '&', '<', '>', '<=', '>='];
  it.each(singletonOps)('%s rejects multiple operands on either side', (op) => {
    for (const expr of [`many ${op} one`, `one ${op} many`, `{} ${op} many`, `many ${op} {}`]) {
      expect(() => run(expr, { many: [1, 2], one: 1 })).toThrow(
        expect.objectContaining({ code: 'eval/singleton-expected' }),
      );
    }
  });
  it.each(['(1 | 2) in {}', '{} contains (1 | 2)'])('%s checks the searched singleton', (expr) => {
    expect(() => run(expr)).toThrow(expect.objectContaining({ code: 'eval/singleton-expected' }));
  });
  it.each(['+', '-', '*', '/', 'div', 'mod', '<', '>', '<=', '>=', '=', '!='])(
    '%s propagates empty on either side',
    (op) => {
      for (const expr of [`{} ${op} 1`, `1 ${op} {}`, `{} ${op} {}`]) expect(run(expr)).toEqual([]);
    },
  );
  it.each([
    "1 + '2'",
    "1 - '2'",
    "'a' * 'b'",
    'true / 2',
    "1 div '2'",
    "1 mod '2'",
    "1 & '2'",
    "'2' & 1",
    'true < false',
    "1 >= '1'",
    '1 day div 1 day',
    '1 day mod 1 day',
    '1 day + @2020',
    '@2020 - @2019',
    '1 day * true',
  ])('%s raises type-mismatch with the expression span', (expression) => {
    expect(() => run(expression)).toThrow(
      expect.objectContaining({
        code: 'eval/type-mismatch',
        expression,
        span: expect.objectContaining({ start: 0, end: expression.length }),
      }),
    );
  });
  it.each([
    ["@2020 + 1 'a'", 'eval/invalid-calendar-unit'],
    ["@2020 - 1 'mo'", 'eval/invalid-calendar-unit'],
    ["@2020 + 1 'cm'", 'eval/invalid-calendar-unit'],
    ['@T12 + 1 day', 'eval/invalid-calendar-unit'],
    ['@2020-01-01 + 1 hour', 'eval/invalid-calendar-unit'],
    ['@9999 + 1 year', 'eval/datetime-out-of-range'],
    ['@0001 - 1 year', 'eval/datetime-out-of-range'],
  ])('%s preserves calendar errors', (expression, code) => {
    expect(() => run(expression)).toThrow(expect.objectContaining({ code }));
  });
});

// ADR-0004: native promises/custom thenables follow the same closure tree sequentially.
describe('async operator operands', () => {
  it.each(['1.testAsync() + 2.testThenable()', '1.testThenable() + 2.testAsync()'])(
    '%s',
    async (expression) => {
      expect(await evaluateAsync({}, expression, { functions: testRegistry() })).toEqual([3]);
    },
  );
  it('evaluates operands once, sequentially, and remains reentrant', async () => {
    const events: string[] = [];
    const functions = testRegistry(
      hostFunction('left', async () => {
        events.push('left start');
        await Promise.resolve();
        events.push('left end');
        return [1];
      }),
      hostFunction('right', () => {
        events.push('right');
        return [2];
      }),
    );
    expect(await evaluateAsync({}, 'left() + right()', { functions })).toEqual([3]);
    expect(events).toEqual(['left start', 'left end', 'right']);
    const compiled = compile('a + b');
    expect(
      await Promise.all([
        compiled.evaluateAsync({ a: 1, b: 2 }),
        compiled.evaluateAsync({ a: 3, b: 4 }),
      ]),
    ).toEqual([[3], [7]]);
  });
  it('keeps errors from the right operand even when the left is empty', async () => {
    await expect(evaluateAsync({}, '{} + %missing')).rejects.toMatchObject({
      code: 'eval/undefined-variable',
    });
    await expect(
      evaluateAsync({}, "1.testAsync() + 'a'", { functions: testRegistry() }),
    ).rejects.toMatchObject({ code: 'eval/type-mismatch', span: { start: 0, end: 19 } });
  });
});
