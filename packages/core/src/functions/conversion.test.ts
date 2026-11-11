import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { customThenable, hostFunction, testRegistry } from '../../test/support/test-functions.ts';
import { evaluateAsync, evaluate as evaluateInternal } from '../api/compile.ts';
import { evaluate } from '../index.ts';
import type { Collection, Item } from '../runtime/collection.ts';
import { DateValue } from '../values/datetime/date.ts';
import { DateTimeValue } from '../values/datetime/datetime.ts';
import { TimeValue } from '../values/datetime/time.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { Quantity } from '../values/quantity/quantity.ts';
import { CONVERSION_FUNCTIONS } from './conversion.ts';
import { createRegistry } from './registry.ts';

// N1 §5.5 and its 3.0.0 clarifications.
// https://hl7.org/fhirpath/N1/#conversion
// https://hl7.org/fhirpath/STU3/en/index.html#conversion

/** Each result item as `Type value`, so a table shows the type and the precision it keeps. */
function typed(expression: string, input: unknown = {}): string[] {
  return evaluateInternal(input, expression, { output: 'typed' }).map((item) =>
    describeItem(item as Item),
  );
}

function describeItem(item: Item): string {
  switch (typeof item) {
    case 'boolean':
      return `Boolean ${item}`;
    case 'number':
      return `Integer ${item}`;
    case 'string':
      return `String ${item}`;
    default:
      break;
  }
  if (item instanceof Decimal) return `Decimal ${item}`;
  if (item instanceof DateValue) return `Date ${item}`;
  if (item instanceof DateTimeValue) return `DateTime ${item}`;
  if (item instanceof TimeValue) return `Time ${item}`;
  if (item instanceof Quantity) return `Quantity ${item}`;
  return 'other';
}

/** The result of `toX()` on `source`, as one described item, or undefined for empty. */
function convert(source: string, fn: string): string | undefined {
  const result = typed(`(${source}).${fn}()`);
  expect(result.length).toBeLessThanOrEqual(1);
  return result[0];
}

/** The result of `convertsToX()` on `source`. */
function converts(source: string, fn: string): boolean | undefined {
  const result = evaluate({}, `(${source}).${fn}()`);
  expect(result.length).toBeLessThanOrEqual(1);
  return result[0] as boolean | undefined;
}

const patient = Object.freeze({
  resourceType: 'Patient',
  birthDate: '1974-12-25',
  active: true,
  name: Object.freeze([
    Object.freeze({ family: 'Chalmers', given: Object.freeze(['Peter', 'James']) }),
    Object.freeze({ given: Object.freeze(['Jim']) }),
  ]),
});
const unborn = Object.freeze({ resourceType: 'Patient' });

describe('the conversion functions are in the standard library', () => {
  it('registers every function of N1 §5.5 once', () => {
    const names = CONVERSION_FUNCTIONS.map((definition) => definition.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(createRegistry().get(name)).toBeDefined();
    }
    expect(names.sort()).toEqual(
      [
        'iif',
        ...[
          'Boolean',
          'Integer',
          'Decimal',
          'Date',
          'DateTime',
          'Time',
          'String',
          'Quantity',
        ].flatMap((type) => [`to${type}`, `convertsTo${type}`]),
      ].sort(),
    );
  });
});

// https://hl7.org/fhirpath/N1/#iifcriterion-expression-true-result-collection-otherwise-result-collection-collection
// https://hl7.org/fhirpath/STU3/en/index.html#iifcriterion-this--boolean-true-result-this--collection--otherwise-result-this--collection--collection
describe('iif', () => {
  it.each([
    // 3.0.0 examples: called with no context.
    ["iif(true, 'It is true', 'It is false')", ['It is true']],
    ["iif(false, 'It is true', 'It is false')", ['It is false']],
    ["iif({}, 'It is true', 'It is false')", ['It is false']],
    // With an empty input context: the criterion is still evaluated.
    ["{}.iif(true, 'It is true', 'It is false')", ['It is true']],
    // Singleton evaluation of the criterion, not conversion to Boolean.
    ["iif(1, 'true', 'false')", ['true']],
    ["iif(0, 'true', 'false')", ['true']],
    ["iif('hi', 'true', 'false')", ['true']],
    // testCollectionBoolean4: a union with empty is a single item.
    ['iif({} | true, true, false)', [true]],
    // No otherwise-result: empty.
    ["iif(false, 'yes')", []],
    ["iif({}, 'yes')", []],
    ["iif(true, 'yes')", ['yes']],
    // The branches are collections and are returned as they are.
    ['iif(true, 1 | 2 | 3, 4)', [1, 2, 3]],
    ['iif(false, 1, {})', []],
  ] as const)('%s', (expression, expected) => {
    expect(evaluate(patient, expression)).toEqual(expected);
  });

  it.each([
    // 3.0.0: several ways to return the birthDate, or '(unknown)'.
    "iif(birthDate.exists(), birthDate.toString(), '(unknown)')",
    "birthDate.iif(exists(), $this.toString(), '(unknown)')",
    "birthDate.iif(exists(), toString(), '(unknown)')",
  ])('%s gives the birthDate, or (unknown) when there is none', (expression) => {
    expect(evaluate(patient, expression)).toEqual(['1974-12-25']);
    expect(evaluate(unborn, expression)).toEqual(['(unknown)']);
  });

  it('uses the input as $this, also when it is empty', () => {
    // 3.0.0: "returns the birthdate value, which would also return empty if there was no birthDate".
    expect(evaluate(patient, 'Patient.birthDate.iif(true, $this)')).toEqual(['1974-12-25']);
    expect(evaluate(unborn, 'Patient.birthDate.iif(true, $this)')).toEqual([]);
    // 3.0.0: "will return the evaluation context (e.g. the Patient)".
    expect(evaluate(patient, 'iif(true, $this)')).toEqual([patient]);
    // testIif11 and testIif9.
    expect(
      evaluate({}, "('context').iif($this = 'context', 'true-result', 'false-result')"),
    ).toEqual(['true-result']);
    expect(evaluate({}, "('context').iif(true, $this, 'false-result')")).toEqual(['context']);
    expect(evaluate(patient, 'name[1].iif(family.exists(), family, given)')).toEqual(['Jim']);
    expect(evaluate({}, "{}.iif($this.exists(), 'some', 'none')")).toEqual(['none']);
  });

  it('keeps $index of the enclosing function', () => {
    // 3.0.0: "the $index variable is not set during evaluation of the arguments".
    const options = { functions: testRegistry() };
    expect(evaluateInternal(patient, 'name.testSelect(iif(true, $index))', options)).toEqual([
      0, 1,
    ]);
    // An empty input still evaluates the arguments, with the enclosing $index.
    expect(
      evaluateInternal(patient, 'name.testSelect(nothing.iif(true, $index))', options),
    ).toEqual([0, 1]);
    expect(
      evaluateInternal(patient, "name.testSelect(family.iif(true, $index, 'x'))", options),
    ).toEqual([0, 1]);
    expect(evaluate({}, "('a').iif(true, $index)")).toEqual([]);
  });

  it('is not evaluated for an empty input inside a lambda', () => {
    // 3.0.0: `{}.select(iif(...))` is empty, the iif is never evaluated.
    const options = { functions: testRegistry() };
    expect(
      evaluateInternal({}, "{}.testSelect(iif(true, 'It is true', 'It is false'))", options),
    ).toEqual([]);
  });

  it('evaluates only the selected branch', () => {
    // testCollectionBoolean5/6 and testIif3/4. %missing raises when it is evaluated.
    expect(evaluate({}, "iif(true, 'a', %missing)")).toEqual(['a']);
    expect(evaluate({}, "iif(false, %missing, 'b')")).toEqual(['b']);
    expect(evaluate({}, "iif({}, %missing, 'b')")).toEqual(['b']);
    expect(evaluate({}, 'iif(true, true, (1 | 2).toString())')).toEqual([true]);
    expect(evaluate({}, 'iif(false, (1 | 2).toString(), true)')).toEqual([true]);
    expect(() => evaluate({}, 'iif(true, %missing)')).toThrow(
      expect.objectContaining({ code: 'eval/undefined-variable' }),
    );
    expect(() => evaluate({}, "iif(false, 'a', %missing)")).toThrow(
      expect.objectContaining({ code: 'eval/undefined-variable' }),
    );
  });

  it.each([
    // testCollectionBoolean1: a criterion with more than one item.
    'iif(1 | 2 | 3, true, false)',
    // testIif10: more than one input item.
    "('item1' | 'item2').iif(true, 'true-result', 'false-result')",
    // The input is checked before the criterion is evaluated.
    "(1 | 2).iif(%missing, 'a')",
    'name.iif(true, 1)',
  ])('%s raises eval/singleton-expected', (expression) => {
    expect(() => evaluate(patient, expression)).toThrow(
      expect.objectContaining({ code: 'eval/singleton-expected' }),
    );
  });

  it('checks its arity at compile time', () => {
    for (const expression of ['iif(true)', 'iif(true, 1, 2, 3)', 'iif()']) {
      expect(() => evaluate({}, expression)).toThrow(
        expect.objectContaining({ code: 'semantic/wrong-arity' }),
      );
    }
  });

  // ADR-0004: lambda arguments in sync and async mode.
  it.each(['promise', 'custom thenable', 'cross-realm promise'] as const)(
    'adopts a %s from the criterion and from the branch',
    async (mode) => {
      const answer = hostFunction('answer', (input) => {
        switch (mode) {
          case 'promise':
            return Promise.resolve(input);
          case 'custom thenable':
            return customThenable(input);
          case 'cross-realm promise':
            return runInNewContext('Promise.resolve(input)', { input }) as PromiseLike<Collection>;
        }
      });
      const options = { functions: testRegistry(answer) };
      expect(await evaluateAsync({}, "iif(true.answer(), 'a', %missing)", options)).toEqual(['a']);
      expect(await evaluateAsync({}, "iif(false.answer(), %missing, 'b')", options)).toEqual(['b']);
      expect(await evaluateAsync({}, "iif(true, 'a'.answer(), 'b')", options)).toEqual(['a']);
      expect(await evaluateAsync({}, "('x').iif($this.answer() = 'x', 'yes')", options)).toEqual([
        'yes',
      ]);
      await expect(
        evaluateAsync({}, 'iif(true.answer(), %missing)', options),
      ).rejects.toMatchObject({ code: 'eval/undefined-variable' });
      expect(() => evaluateInternal({}, "iif(true.answer(), 'a')", options)).toThrow(
        expect.objectContaining({ code: 'eval/async-in-sync' }),
      );
      expect(() => evaluateInternal({}, "iif(true, 'a'.answer())", options)).toThrow(
        expect.objectContaining({ code: 'eval/async-in-sync' }),
      );
      expect(evaluateInternal({}, "iif(false, 'a'.answer(), 'b')", options)).toEqual(['b']);
    },
  );
});

// https://hl7.org/fhirpath/N1/#toboolean-boolean
// https://hl7.org/fhirpath/STU3/en/index.html#toboolean--boolean
describe('toBoolean and convertsToBoolean', () => {
  it.each([
    ['true', true],
    ['false', false],
    ['1', true],
    ['0', false],
    ['1.0', true],
    ['0.0', false],
    // 3.0.0: "1.0 (or decimal equivalent)".
    ['1.00', true],
    ['0.000', false],
    ['-0.0', false],
    // The strings of the table, in any case.
    ["'true'", true],
    ["'t'", true],
    ["'yes'", true],
    ["'y'", true],
    ["'1'", true],
    ["'1.0'", true],
    ["'false'", false],
    ["'f'", false],
    ["'no'", false],
    ["'n'", false],
    ["'0'", false],
    ["'0.0'", false],
    ["'TRUE'", true],
    ["'True'", true],
    ["'T'", true],
    ["'YeS'", true],
    ["'Y'", true],
    ["'FALSE'", false],
    ["'False'", false],
    ["'F'", false],
    ["'No'", false],
    ["'N'", false],
  ] as const)('%s converts to %s', (source, expected) => {
    expect(convert(source, 'toBoolean')).toBe(`Boolean ${expected}`);
    expect(converts(source, 'convertsToBoolean')).toBe(true);
  });

  it.each([
    '2',
    '-1',
    '1.5',
    '0.1',
    "'hello'",
    "'abc'",
    "''",
    "' true'",
    "'true '",
    "'1.00'",
    "'2'",
    "'+1'",
    "'on'",
    "'off'",
    '@2014-01-01',
    '@2014-01-01T10:00',
    '@T10:00',
    "1 'mg'",
    '1 day',
  ])('%s does not convert', (source) => {
    expect(convert(source, 'toBoolean')).toBeUndefined();
    expect(converts(source, 'convertsToBoolean')).toBe(false);
  });

  it('reads input data by its value', () => {
    expect(evaluate(patient, 'active.toBoolean()')).toEqual([true]);
    expect(evaluate({ flag: 'Y' }, 'flag.toBoolean()')).toEqual([true]);
    expect(evaluate(patient, 'name[0].toBoolean()')).toEqual([]);
    expect(evaluate(patient, 'name[0].convertsToBoolean()')).toEqual([false]);
  });
});

// https://hl7.org/fhirpath/N1/#tointeger-integer
describe('toInteger and convertsToInteger', () => {
  it.each([
    ['1', 1],
    ['0', 0],
    ['-1', -1],
    ['2147483647', 2147483647],
    ['-2147483648', -2147483648],
    ['true', 1],
    ['false', 0],
    ["'1'", 1],
    ["'-1'", -1],
    ["'+1'", 1],
    ["'0'", 0],
    ["'-0'", 0],
    ["'007'", 7],
    ["'2147483647'", 2147483647],
    ["'-2147483648'", -2147483648],
  ] as const)('%s converts to %s', (source, expected) => {
    expect(convert(source, 'toInteger')).toBe(`Integer ${expected}`);
    expect(converts(source, 'convertsToInteger')).toBe(true);
  });

  it('does not give a negative zero', () => {
    expect(Object.is(evaluate({}, "'-0'.toInteger()")[0], 0)).toBe(true);
  });

  it.each([
    // A Decimal does not convert to an Integer, not even a whole one.
    '1.0',
    '1.5',
    "'1.0'",
    "'1.1'",
    "'0.0'",
    // Outside the 32-bit range.
    "'2147483648'",
    "'-2147483649'",
    `'${'9'.repeat(400)}'`,
    // Not in the form (\+|-)?\d+.
    "'1e3'",
    "' 1'",
    "'1 '",
    "''",
    "'+'",
    "'-'",
    "'+-1'",
    "'1,000'",
    "'st'",
    "'a'",
    "'0x10'",
    // Only ASCII digits.
    "'١'",
    "'１'",
    '@2014',
    '@T10:00',
    "1 'mg'",
  ])('%s does not convert', (source) => {
    expect(convert(source, 'toInteger')).toBeUndefined();
    expect(converts(source, 'convertsToInteger')).toBe(false);
  });
});

// https://hl7.org/fhirpath/N1/#todecimal-decimal
describe('toDecimal and convertsToDecimal', () => {
  it.each([
    ['1', '1'],
    ['-1', '-1'],
    ['2147483647', '2147483647'],
    ['1.0', '1.0'],
    ['0.1', '0.1'],
    ['-0.1', '-0.1'],
    ['1234567890987654321.0', '1234567890987654321.0'],
    // N1: true results in 1.0 and false in 0.0.
    ['true', '1.0'],
    ['false', '0.0'],
    ["'1'", '1'],
    ["'1.0'", '1.0'],
    ["'1.50'", '1.50'],
    ["'-1'", '-1'],
    ["'+1.5'", '1.5'],
    ["'0.0'", '0.0'],
    ["'0.00000001'", '0.00000001'],
    ["'0012.30'", '12.30'],
  ] as const)('%s converts to %s', (source, expected) => {
    expect(convert(source, 'toDecimal')).toBe(`Decimal ${expected}`);
    expect(converts(source, 'convertsToDecimal')).toBe(true);
  });

  it.each([
    "'1.'",
    "'.5'",
    "'1.a'",
    "'1e3'",
    "'1,5'",
    "' 1'",
    "'1.2.3'",
    "''",
    "'st'",
    "'42L'",
    // Beyond the Decimal size bound.
    `'1${'0'.repeat(10_000)}'`,
    "1 'mg'",
    '@2014',
    '@T10:00',
  ])('%s does not convert', (source) => {
    expect(convert(source, 'toDecimal')).toBeUndefined();
    expect(converts(source, 'convertsToDecimal')).toBe(false);
  });
});

// https://hl7.org/fhirpath/N1/#todate-date
// https://hl7.org/fhirpath/STU3/en/index.html#todateformat--string--date
describe('toDate and convertsToDate', () => {
  it.each([
    ['@2014-01-25', '2014-01-25'],
    ['@2014-01', '2014-01'],
    ['@2014', '2014'],
    // The date part, without timezone conversion (3.0.0 example).
    ['@2024-01-15T23:30:00-05:00', '2024-01-15'],
    ['@2014-01-25T14:30:14.559+01:00', '2014-01-25'],
    ['@2014-01T', '2014-01'],
    ['@2014T', '2014'],
    ["'2015'", '2015'],
    ["'2015-02'", '2015-02'],
    ["'2015-02-04'", '2015-02-04'],
    ["'2024-02-29'", '2024-02-29'],
  ] as const)('%s converts to %s', (source, expected) => {
    expect(convert(source, 'toDate')).toBe(`Date ${expected}`);
    expect(converts(source, 'convertsToDate')).toBe(true);
  });

  it.each([
    "'2015-02-30'",
    "'2023-02-29'",
    "'2015-13'",
    "'2015-2-4'",
    "'0000'",
    "'2015-02-04T14:34'",
    "'15-02-2015'",
    "'2015/02/04'",
    "'20150204'",
    "'@2015-02-04'",
    "'not-a-date'",
    "''",
    '@T10:00',
    '1',
    'true',
  ])('%s does not convert', (source) => {
    expect(convert(source, 'toDate')).toBeUndefined();
    expect(converts(source, 'convertsToDate')).toBe(false);
  });
});

// https://hl7.org/fhirpath/N1/#todatetime-datetime
describe('toDateTime and convertsToDateTime', () => {
  it.each([
    ['@2014-01-25T14:30:14.559+01:00', '2014-01-25T14:30:14.559+01:00'],
    // A Date gives a DateTime with the time components empty, not zero.
    ['@2014-01-25', '2014-01-25'],
    ['@2014', '2014'],
    // testTypes: the string forms, at their own precision.
    ["'2015'", '2015'],
    ["'2015-02'", '2015-02'],
    ["'2015-02-04'", '2015-02-04'],
    ["'2015-02-04T14'", '2015-02-04T14'],
    ["'2015-02-04T14:34'", '2015-02-04T14:34'],
    ["'2015-02-04T14:34:28'", '2015-02-04T14:34:28'],
    ["'2015-02-04T14:34:28.123'", '2015-02-04T14:34:28.123'],
    ["'2015-02-04T14:34:28Z'", '2015-02-04T14:34:28Z'],
    ["'2015-02-04T14:34:28+10:00'", '2015-02-04T14:34:28+10:00'],
    ["'2015-02-04T14:34:28-00:00'", '2015-02-04T14:34:28Z'],
    // Fractional seconds beyond milliseconds are truncated.
    ["'2015-02-04T14:34:28.123456'", '2015-02-04T14:34:28.123'],
  ] as const)('%s converts to %s', (source, expected) => {
    expect(convert(source, 'toDateTime')).toBe(`DateTime ${expected}`);
    expect(converts(source, 'convertsToDateTime')).toBe(true);
  });

  it.each([
    "'2015-02-04T'",
    "'2015T10:00'",
    "'2015-02-04 14:34'",
    "'2015-02-04T25:00'",
    "'2015-02-04T14:34:28+15:00'",
    "'2015-02-04T14:34:28+01'",
    "'not a datetime'",
    "'14:34'",
    "''",
    '@T14:00',
    '1',
  ])('%s does not convert', (source) => {
    expect(convert(source, 'toDateTime')).toBeUndefined();
    expect(converts(source, 'convertsToDateTime')).toBe(false);
  });
});

// https://hl7.org/fhirpath/N1/#totime-time
describe('toTime and convertsToTime', () => {
  it.each([
    ['@T14:34:28.123', '14:34:28.123'],
    ['@T14', '14'],
    ["'14'", '14'],
    ["'14:34'", '14:34'],
    ["'14:34:28'", '14:34:28'],
    ["'14:34:28.123'", '14:34:28.123'],
    ["'10:00'", '10:00'],
    ["'23:59:59.999'", '23:59:59.999'],
  ] as const)('%s converts to %s', (source, expected) => {
    expect(convert(source, 'toTime')).toBe(`Time ${expected}`);
    expect(converts(source, 'convertsToTime')).toBe(true);
  });

  it.each([
    // A Time has no timezone.
    "'14:34:28Z'",
    "'14:34:28+01:00'",
    "'24:00'",
    "'14:60'",
    "'1:00'",
    "'T14:34'",
    "'not a time'",
    "''",
    "'2015-02-04T14:34'",
    // No DateTime → Time conversion is defined.
    '@2015-02-04T14:34',
    '14',
  ])('%s does not convert', (source) => {
    expect(convert(source, 'toTime')).toBeUndefined();
    expect(converts(source, 'convertsToTime')).toBe(false);
  });
});

// https://hl7.org/fhirpath/N1/#tostring-string
// https://hl7.org/fhirpath/STU3/en/index.html#tostring--string
describe('toString and convertsToString', () => {
  it.each([
    ["'true'", 'true'],
    ["''", ''],
    ['true', 'true'],
    ['false', 'false'],
    ['1', '1'],
    ['-1', '-1'],
    ['0', '0'],
    ['2147483647', '2147483647'],
    // A Decimal keeps its precision and is never written with an exponent.
    ['1.0', '1.0'],
    ['0.0', '0.0'],
    ['3.14', '3.14'],
    ['1.50', '1.50'],
    ['-0.1', '-0.1'],
    ['0.00000001', '0.00000001'],
    // A UCUM unit is quoted, a calendar keyword is not and is written in the singular.
    ["1 'wk'", "1 'wk'"],
    ['1 week', '1 week'],
    ["53 'km'", "53 'km'"],
    ['4 days', '4 day'],
    ["1.50 'mg'", "1.50 'mg'"],
    ["10 'mm[Hg]'", "10 'mm[Hg]'"],
    ["1 '1'", "1 '1'"],
    // Dates and times without @ or T, to their own precision.
    ['@2014-12-14', '2014-12-14'],
    ['@2014-12', '2014-12'],
    ['@2014', '2014'],
    ['@2020-01-01T10:00:00.000+10:00', '2020-01-01T10:00:00.000+10:00'],
    ['@2014-01-25T14:30:14.559-05:30', '2014-01-25T14:30:14.559-05:30'],
    ['@2014-01-25T14:30', '2014-01-25T14:30'],
    ['@2014-01-25T14:30+00:00', '2014-01-25T14:30Z'],
    ['@2014T', '2014'],
    ['@T10:30:00.000', '10:30:00.000'],
    ['@T11:45', '11:45'],
  ] as const)('%s is %j', (source, expected) => {
    expect(convert(source, 'toString')).toBe(`String ${expected}`);
    expect(converts(source, 'convertsToString')).toBe(true);
  });

  it('reads input data by its value, and a resource or complex value is not a String', () => {
    expect(evaluate(patient, 'birthDate.toString()')).toEqual(['1974-12-25']);
    expect(evaluate({ value: 1.5 }, 'value.toString()')).toEqual(['1.5']);
    expect(evaluate(patient, 'name[0].toString()')).toEqual([]);
    expect(evaluate(patient, 'name[0].convertsToString()')).toEqual([false]);
    expect(evaluate(patient, 'Patient.toString()')).toEqual([]);
  });
});

// https://hl7.org/fhirpath/N1/#toquantityunit-string-quantity
// https://hl7.org/fhirpath/STU3/en/index.html#toquantityunit--string--quantity
describe('toQuantity and convertsToQuantity', () => {
  it.each([
    ['1', "1 '1'"],
    ['1.0', "1.0 '1'"],
    ['-2.50', "-2.50 '1'"],
    ["10.1 'mg'", "10.1 'mg'"],
    ['4 days', '4 day'],
    ['true', "1.0 '1'"],
    ['false', "0.0 '1'"],
    ["'1'", "1 '1'"],
    ["'1.0'", "1.0 '1'"],
    ["'-1.5'", "-1.5 '1'"],
    ["'+3'", "3 '1'"],
    // N1 and 3.0.0 examples, and testTypes.
    ["'4 days'", '4 day'],
    ["'10 \\'mg[Hg]\\''", "10 'mg[Hg]'"],
    ["'10 \\'mm[Hg]\\''", "10 'mm[Hg]'"],
    ["'1 day'", '1 day'],
    ["'1 \\'wk\\''", "1 'wk'"],
    ["'1 month'", '1 month'],
    ["'1 year'", '1 year'],
    ["'1 milliseconds'", '1 millisecond'],
    // \s* allows no space and any whitespace.
    ["'1day'", '1 day'],
    ["'1\\'mg\\''", "1 'mg'"],
    ["'1 \\t \\'mg\\''", "1 'mg'"],
    // A quoted unit is taken as written, as in a literal.
    ["'5 \\'foo\\''", "5 'foo'"],
    ["'1 \\'d\\''", "1 'd'"],
  ] as const)('%s converts to %s', (source, expected) => {
    expect(convert(source, 'toQuantity')).toBe(`Quantity ${expected}`);
    expect(converts(source, 'convertsToQuantity')).toBe(true);
  });

  it.each([
    // An unquoted word must be a calendar keyword.
    "'1 wk'",
    "'1 Day'",
    "'1 mg'",
    "'1.a'",
    "'a'",
    "''",
    "'\\'mg\\''",
    "'1 \\'\\''",
    "'1 \\'mg'",
    "'1 mg\\''",
    "' 1'",
    "'1 \\'mg\\' '",
    "'1.'",
    "'1 days days'",
    "'1e3 \\'mg\\''",
    `'1${'0'.repeat(10_000)} day'`,
    '@2014',
    '@T10:00',
  ])('%s does not convert', (source) => {
    expect(convert(source, 'toQuantity')).toBeUndefined();
    expect(converts(source, 'convertsToQuantity')).toBe(false);
  });

  // 3.0.0 examples that the minimal unit system covers; UCUM ones are in
  // packages/core/test/conversion-models.test.ts.
  it.each([
    ["1 'wk'.toQuantity('d')", "7 'd'"],
    ["1 'a'.toQuantity('d')", "365.25 'd'"],
    ["7 days.toQuantity('wk')", "1 'wk'"],
    ["182.5 days.toQuantity('a')", "0.5 'a'"],
    ["182.5 'd'.toQuantity('a')", "0.4996577686516084873374401095 'a'"],
    ["1 week.toQuantity('days')", '7 day'],
    ["'1 day'.toQuantity('h')", "24 'h'"],
    // 3.0.0: years and months take the shortest chain, so a year is 12 months.
    ["'1 year'.toQuantity('mo')", "12 'mo'"],
    ["5 'mg'.toQuantity('mg')", "5 'mg'"],
    ["1.toQuantity('1')", "1 '1'"],
    // An empty unit converts nothing.
    ["1 'mg'.toQuantity({})", "1 'mg'"],
  ] as const)('%s is %s', (expression, expected) => {
    expect(typed(expression)).toEqual([`Quantity ${expected}`]);
    const asConverts = expression.replace('.toQuantity(', '.convertsToQuantity(');
    expect(evaluate({}, asConverts)).toEqual([true]);
  });

  it.each([
    // 3.0.0: "There is no conversion from the UCUM default unit to meters."
    "45.toQuantity('m')",
    "1 'mg'.toQuantity('s')",
    "1 year.toQuantity('mg')",
  ])('%s is empty when the units cannot be related', (expression) => {
    expect(typed(expression)).toEqual([]);
    const asConverts = expression.replace('.toQuantity(', '.convertsToQuantity(');
    expect(evaluate({}, asConverts)).toEqual([false]);
  });

  it.each([
    ['1.toQuantity(%one)', 'eval/type-mismatch'],
    ['1.convertsToQuantity(%flag)', 'eval/type-mismatch'],
    ["1.toQuantity('a' | 'b')", 'eval/singleton-expected'],
  ])('%s raises %s for a unit that is not a single String', (expression, code) => {
    expect(() => evaluate({}, expression, { variables: { one: 1, flag: true } })).toThrow(
      expect.objectContaining({ code }),
    );
  });

  // T0024: a unit literal that is not a String is rejected when the expression is compiled.
  it.each(['1.toQuantity(1)', '1.convertsToQuantity(true)'])(
    '%s raises semantic/type-mismatch at compile time',
    (expression) => {
      expect(() => evaluate({}, expression)).toThrow(
        expect.objectContaining({ code: 'semantic/type-mismatch' }),
      );
    },
  );

  it('uses the unit system of the compilation', () => {
    const units = {
      parse: (unit: string) => ({ unit }),
      convert: (value: Decimal, from: string, to: string) =>
        from === 'x' && to === 'y' ? value.multiply(Decimal.of(2n)) : undefined,
      multiply: () => undefined,
      divide: () => undefined,
    };
    expect(evaluateInternal({}, "3 'x'.toQuantity('y')", { units, output: 'typed' })).toEqual([
      new Quantity(Decimal.of(6n), 'y'),
    ]);
    expect(evaluateInternal({}, "3 'x'.toQuantity('z')", { units })).toEqual([]);
  });
});

describe('every conversion function', () => {
  const conversions = ['Boolean', 'Integer', 'Decimal', 'Date', 'DateTime', 'Time', 'String'];

  it.each(conversions.concat('Quantity'))(
    'to%s and convertsTo%s give empty for empty input',
    (type) => {
      expect(evaluate({}, `{}.to${type}()`)).toEqual([]);
      expect(evaluate({}, `{}.convertsTo${type}()`)).toEqual([]);
      expect(evaluate(unborn, `birthDate.convertsTo${type}()`)).toEqual([]);
    },
  );

  it.each(conversions.concat('Quantity'))(
    'to%s and convertsTo%s raise eval/singleton-expected for more than one item',
    (type) => {
      for (const fn of [`to${type}`, `convertsTo${type}`]) {
        expect(() => evaluate({}, `('1' | '2').${fn}()`)).toThrow(
          expect.objectContaining({ code: 'eval/singleton-expected' }),
        );
      }
    },
  );

  it('converts a single item whatever the target, without throwing for its type', () => {
    for (const type of conversions.concat('Quantity')) {
      expect(evaluate(patient, `name[0].convertsTo${type}()`)).toEqual([false]);
      expect(evaluate(patient, `name[0].to${type}()`)).toEqual([]);
    }
  });

  it('works without a target, on the focus', () => {
    expect(evaluate('5', 'toInteger()')).toEqual([5]);
    expect(evaluate({ values: ['1', 'x'] }, 'values.where(convertsToInteger())')).toEqual(['1']);
  });

  it('raises the error at the call, with its span', () => {
    expect(() => evaluate({}, "'a' + (1 | 2).toString()")).toThrow(
      expect.objectContaining({
        code: 'eval/singleton-expected',
        span: expect.objectContaining({ start: 6, end: 24 }),
      }),
    );
  });
});
