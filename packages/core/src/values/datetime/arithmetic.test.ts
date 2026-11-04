import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FhirPathEvaluationError } from '../../errors/fhirpath-error.ts';
import type { DecimalAmount } from './arithmetic.ts';
import { addCalendar, subtractCalendar } from './arithmetic.ts';
import { compareTemporal } from './compare.ts';
import { DateValue } from './date.ts';
import { DateTimeValue } from './datetime.ts';
import { parseTemporalLiteral } from './parse.ts';
import type { TemporalValue } from './temporal-value.ts';
import { TimeValue } from './time.ts';

function literal(text: string): TemporalValue {
  const value = parseTemporalLiteral(text);
  if (value === undefined) {
    throw new Error(`Invalid literal in test: ${text}`);
  }
  return value;
}

/** A decimal literal as `coefficient × 10^-scale`, the shape of the T0004 `Decimal`. */
function decimal(text: string): DecimalAmount {
  const [whole = '', fraction = ''] = text.split('.');
  return { coefficient: BigInt(whole + fraction), scale: fraction.length };
}

/**
 * Evaluates `<literal> (+|-) <amount> <unit>`, where the unit is a calendar keyword or a quoted
 * UCUM unit, and returns the result as a literal.
 */
function calculate(expression: string): string {
  const match = /^(\S+) ([+-]) (-?\d+(?:\.\d+)?) '?([a-z]+)'?$/.exec(expression);
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined ||
    match[4] === undefined
  ) {
    throw new Error(`Malformed test expression: ${expression}`);
  }
  const value = literal(match[1]);
  const amount = decimal(match[3]);
  const result =
    match[2] === '+'
      ? addCalendar(value, amount, match[4])
      : subtractCalendar(value, amount, match[4]);
  return result.toLiteral();
}

function errorCodeOf(expression: string): string | undefined {
  try {
    calculate(expression);
  } catch (error) {
    return error instanceof FhirPathEvaluationError ? error.code : 'not a FhirPathEvaluationError';
  }
  return undefined;
}

type Row = readonly [expression: string, expected: string];

describe('date/time arithmetic', () => {
  // https://hl7.org/fhirpath/N1/#datetime-arithmetic
  it.each<Row>([
    ['@2014 + 24 months', '@2016'],
    ['@2019-03-01 + 24 months', '@2021-03-01'],
    ['@2014 + 23 months', '@2015'],
    ['@2016 + 365 days', '@2017'],
    ['@2014 - 24 months', '@2012'],
    ['@2019-03-01 - 24 months', '@2017-03-01'],
  ])('%s = %s (N1 §6.7)', (expression, expected) => {
    expect(calculate(expression)).toBe(expected);
  });

  // https://hl7.org/fhirpath/STU3/ Date/Time Arithmetic, + and - examples
  it.each<Row>([
    ['@1973-12-25 + 7 days', '@1974-01-01'],
    ['@1973-12-25 + 7.9 days', '@1974-01-01'],
    ['@1973-12-25 + 1 week', '@1974-01-01'],
    ['@2019-03-01 + 24 months', '@2021-03-01'],
    ['@2026-01-31 + 1 month', '@2026-02-28'],
    ['@2026-01-01T13:00:00 + 30 minutes', '@2026-01-01T13:30:00'],
    ['@1973-12-25T00:00:00.000+10:00 + 42.53 seconds', '@1973-12-25T00:00:42.530+10:00'],
    ["@1973-12-25 + 1 'd'", '@1973-12-26'],
    ['@T23:30:00 + 1 hour', '@T00:30:00'],
    ['@T01:00:00 + 48 hour', '@T01:00:00'],
    ['@2014 + 24 months', '@2016'],
    ['@2014 + 23 months', '@2015'],
    ['@2016 + 365 days', '@2017'],
    ['@2014 + 11 months', '@2014'],
    ['@2026-02 + 5 weeks', '@2026-03'],
    ['@2026-02 + 4 weeks', '@2026-02'],
    ['@T00:30:00 - 1 hour', '@T23:30:00'],
    ['@T01:00:00 - 2 hours', '@T23:00:00'],
    ['@2014 - 24 months', '@2012'],
    ['@2019-03-01 - 24 months', '@2017-03-01'],
    ['@2014 - 1 month', '@2014'],
    ['@2026-02 - 1 day', '@2026-02'],
  ])('%s = %s (3.0.0)', (expression, expected) => {
    expect(calculate(expression)).toBe(expected);
  });

  // HL7 test suite: testPlusDate*, testPlusTime*, testMinus*
  it.each<Row>([
    ['@1973-12-25 + 7 days', '@1974-01-01'], // testPlusDate1
    ['@1973-12-25 + 7.7 days', '@1974-01-01'], // testPlusDate2
    ['@1973-12-25T00:00:00.000+10:00 + 7 days', '@1974-01-01T00:00:00.000+10:00'], // testPlusDate3
    ['@1973-12-25T00:00:00.000+10:00 + 7.7 days', '@1974-01-01T00:00:00.000+10:00'], // testPlusDate4
    ['@1973-12-25T00:00:00.000+10:00 + 1 second', '@1973-12-25T00:00:01.000+10:00'], // testPlusDate5
    ['@1973-12-25T00:00:00.000+10:00 + 10 millisecond', '@1973-12-25T00:00:00.010+10:00'], // testPlusDate6
    ['@1973-12-25T00:00:00.000+10:00 + 1 minute', '@1973-12-25T00:01:00.000+10:00'], // testPlusDate7
    ['@1973-12-25T00:00:00.000+10:00 + 1 hour', '@1973-12-25T01:00:00.000+10:00'], // testPlusDate8
    ['@1973-12-25 + 1 day', '@1973-12-26'], // testPlusDate9
    ['@1973-12-25 + 1 month', '@1974-01-25'], // testPlusDate10
    ['@1973-12-25 + 1 week', '@1974-01-01'], // testPlusDate11
    ['@1973-12-25 + 1 year', '@1974-12-25'], // testPlusDate12
    ["@1973-12-25 + 1 'd'", '@1973-12-26'], // testPlusDate13
    ["@1973-12-25 + 1 'wk'", '@1974-01-01'], // testPlusDate15
    ["@1973-12-25T00:00:00.000+10:00 + 1 's'", '@1973-12-25T00:00:01.000+10:00'], // testPlusDate18
    ["@1973-12-25T00:00:00.000+10:00 + 0.1 's'", '@1973-12-25T00:00:00.100+10:00'], // testPlusDate19
    ["@1973-12-25T00:00:00.000+10:00 + 10 'ms'", '@1973-12-25T00:00:00.010+10:00'], // testPlusDate20
    ["@1973-12-25T00:00:00.000+10:00 + 1 'min'", '@1973-12-25T00:01:00.000+10:00'], // testPlusDate21
    ["@1973-12-25T00:00:00.000+10:00 + 1 'h'", '@1973-12-25T01:00:00.000+10:00'], // testPlusDate22
    ['@2015-02-04T10:00Z + 1 hour', '@2015-02-04T11:00Z'], // testPlusDate23
    ['@2015-02-04T10Z + 1 hour', '@2015-02-04T11Z'], // testPlusDate24
    ['@T01:00:00 + 2 hours', '@T03:00:00'], // testPlusTime1
    ['@T23:00:00 + 2 hours', '@T01:00:00'], // testPlusTime2
    ['@T23:00:00 + 50 hours', '@T01:00:00'], // testPlusTime3
    ["@1974-12-25 - 1 'month'", '@1974-11-25'], // testMinus5 (contested; see spec-notes.md)
    ['@T00:30:00 - 1 hour', '@T23:30:00'], // testMinus7
    ['@T01:00:00 - 2 hours', '@T23:00:00'], // testMinus8
    ['@2015-02-04T10:00Z - 1 day', '@2015-02-03T10:00Z'], // testMinus9
  ])('%s = %s', (expression, expected) => {
    expect(calculate(expression)).toBe(expected);
  });

  it.each<Row>([
    ['@2020-01-31 + 1 month', '@2020-02-29'],
    ['@2021-01-31 + 1 month', '@2021-02-28'],
    ['@2020-02-29 + 1 year', '@2021-02-28'],
    ['@2020-02-29 + 4 years', '@2024-02-29'],
    ['@2020-03-31 - 1 month', '@2020-02-29'],
    ['@2020-05-31 + 1 month', '@2020-06-30'],
    ['@2020-01-31T10:00Z + 1 month', '@2020-02-29T10:00Z'],
    ['@2020-12-15 + 1 month', '@2021-01-15'],
    ['@2020-01-15 - 1 month', '@2019-12-15'],
    ['@2020-01-15 - 13 months', '@2018-12-15'],
    ['@2020-01 + 1 month', '@2020-02'],
    ['@2020-12 + 1 month', '@2021-01'],
  ])('%s = %s (month-end clamping and month carry)', (expression, expected) => {
    expect(calculate(expression)).toBe(expected);
  });

  it.each<Row>([
    ['@2016-02-28 + 1 day', '@2016-02-29'],
    ['@2015-02-28 + 1 day', '@2015-03-01'],
    ['@2000-02-28 + 1 day', '@2000-02-29'],
    ['@1900-02-28 + 1 day', '@1900-03-01'],
    ['@2016-12-31 + 1 day', '@2017-01-01'],
    ['@2016-03-01 - 1 day', '@2016-02-29'],
    ['@2016-02-28T12:00 + 1 day', '@2016-02-29T12:00'],
    ['@2016-12-31T23:59:59.999Z + 1 millisecond', '@2017-01-01T00:00:00.000Z'],
  ])('%s = %s (leap years and calendar lengths)', (expression, expected) => {
    expect(calculate(expression)).toBe(expected);
  });

  it.each<Row>([
    ['@1974-01-01 + -7 days', '@1973-12-25'],
    ['@1974-01-01 - -7 days', '@1974-01-08'],
    ['@1973-12-25 - 7.9 days', '@1973-12-18'],
    ['@2014 + -23 months', '@2013'],
    ['@2014 - 23 months', '@2013'],
    ['@T00:00 - 1 minute', '@T23:59'],
    ['@T00:00:00.000 - 1 millisecond', '@T23:59:59.999'],
    ['@2015-02-04T00:30-14:00 - 1 hour', '@2015-02-03T23:30-14:00'],
  ])('%s = %s (negative amounts)', (expression, expected) => {
    expect(calculate(expression)).toBe(expected);
  });

  it.each<Row>([
    // The quantity is converted to the value's precision and the remainder dropped.
    ['@2015-02-04T10 + 90 minutes', '@2015-02-04T11'],
    ['@2015-02-04T10:00 + 90 seconds', '@2015-02-04T10:01'],
    ['@2015-02-04T10:00:00 + 1500 milliseconds', '@2015-02-04T10:00:01'],
    ['@2015-02-04T10:00:00 + 0.5 seconds', '@2015-02-04T10:00:00'],
    ['@2015-02-04T + 25 hours', '@2015-02-05T'],
    ['@2015-02-04 + 2 weeks', '@2015-02-18'],
    ['@2015-02T + 45 days', '@2015-03T'],
    ['@2015T + 400 days', '@2016T'],
    ['@2015T + 8760 hours', '@2016T'],
    ['@2015T + 8759 hours', '@2015T'],
    ['@T10 + 59 minutes', '@T10'],
    ['@T10:00:00 + 0.5 seconds', '@T10:00:00'],
    // Above seconds the fraction is dropped; seconds keep it down to milliseconds.
    ['@2015-02-04T10:00:00.000 + 1.5 hours', '@2015-02-04T11:00:00.000'],
    ['@2015-02-04T10:00:00.000 + 1.5 milliseconds', '@2015-02-04T10:00:00.001'],
    ['@2015-02-04T10:00:00.000 + 1.9999 seconds', '@2015-02-04T10:00:01.999'],
    ['@T10:00 + 1.5 hours', '@T11:00'],
    ['@T10:00:00.000 + 0.5 seconds', '@T10:00:00.500'],
    ['@2015 + 1.5 years', '@2016'],
    // The fraction of a year is dropped in years, not after converting to months.
    ['@2015-01-01 + 1.5 years', '@2016-01-01'],
    ['@2015-01-01 - 1.5 years', '@2014-01-01'],
    ['@2015-01 + 1.9 years', '@2016-01'],
    ['@2015-01-01T10:00Z + 1.5 years', '@2016-01-01T10:00Z'],
    ['@2015-01-01T10:00Z - 1.5 years', '@2014-01-01T10:00Z'],
    ['@2015-01-01 + -1.5 years', '@2014-01-01'],
    ['@2015-01-01 + 2.5 months', '@2015-03-01'],
    ['@2015-01-01 - 2.5 months', '@2014-11-01'],
    ['@2015-01 + 18.5 months', '@2016-07'],
  ])('%s = %s (partial values and fractions)', (expression, expected) => {
    expect(calculate(expression)).toBe(expected);
  });

  it.each<Row>([
    ['@2015-02-04T23:30+14:00 + 1 hour', '@2015-02-05T00:30+14:00'],
    ['@2015-02-04T10:00 + 1 day', '@2015-02-05T10:00'],
    ["@2020-01-31T10:00 + 1 'wk'", '@2020-02-07T10:00'],
    ['@T23:59:59.999 + 1 millisecond', '@T00:00:00.000'],
    ['@T10:00 + 1000000000000000000000 hours', '@T02:00'],
  ])('%s = %s (offsets are kept, Time wraps around)', (expression, expected) => {
    expect(calculate(expression)).toBe(expected);
  });

  it.each([
    ["@1973-12-25 + 1 'mo'", 'testPlusDate14'],
    ["@1973-12-25 + 1 'a'", 'testPlusDate16'],
    ["@1975-12-25 + 1 'a'", 'testPlusDate17'],
    ["@1974-12-25 - 1 'cm'", 'testMinus6'],
    ["@1973-12-25T10:00 + 1 'mo'", "'mo' on a DateTime"],
    ["@T10:00 + 1 'a'", "'a' on a Time"],
    ['@1973-12-25 + 1 hour', 'hours on a Date'],
    ["@1973-12-25 + 1 'min'", 'minutes on a Date'],
    ['@1973-12-25 + 1 millisecond', 'milliseconds on a Date'],
    ['@T10:00 + 1 day', 'days on a Time'],
    ["@T10:00 + 1 'd'", "'d' on a Time"],
    ['@T10:00 + 1 week', 'weeks on a Time'],
    ['@T10:00 + 1 month', 'months on a Time'],
    ['@T10:00 + 1 year', 'years on a Time'],
    ['@2014 + 1 fortnight', 'an unknown unit'],
  ])('%s raises eval/invalid-calendar-unit (%s)', (expression) => {
    expect(errorCodeOf(expression)).toBe('eval/invalid-calendar-unit');
  });

  it.each([
    '@9999-12-31 + 1 day',
    '@0001-01-01 - 1 day',
    '@9999 + 1 year',
    '@9999-12 + 1 month',
    '@9999-12-31T23:59:59.999 + 1 millisecond',
    '@0001-01-01T00:00 - 1 minute',
    '@9999-12-31T23:30+14:00 + 1 hour',
    '@2014 + 100000 years',
    '@2014-01 + 1000000 months',
    '@2014-01-01 + 1000000000000000000000 days',
    '@2014-01-01T10:00 - 1000000000000000000000 seconds',
  ])('%s raises eval/datetime-out-of-range (N1 §6.7: year out of range)', (expression) => {
    expect(errorCodeOf(expression)).toBe('eval/datetime-out-of-range');
  });

  it('keeps the type of the value', () => {
    expect(addCalendar(literal('@2014-01-01'), 1, 'day')).toBeInstanceOf(DateValue);
    expect(addCalendar(literal('@2014-01-01T'), 1, 'day')).toBeInstanceOf(DateTimeValue);
    expect(addCalendar(literal('@T10:00'), 1, 'hour')).toBeInstanceOf(TimeValue);
  });

  it('accepts JavaScript numbers as amounts', () => {
    expect(addCalendar(literal('@1973-12-25'), 7, 'days').toLiteral()).toBe('@1974-01-01');
    expect(addCalendar(literal('@1973-12-25'), 7.9, 'days').toLiteral()).toBe('@1974-01-01');
    expect(subtractCalendar(literal('@1973-12-25'), -7.9, 'days').toLiteral()).toBe('@1974-01-01');
    expect(addCalendar(literal('@T10:00:00.000'), 42.53, 's').toLiteral()).toBe('@T10:00:42.530');
    expect(addCalendar(literal('@T10:00:00.000'), 0.0015, 's').toLiteral()).toBe('@T10:00:00.001');
    expect(addCalendar(literal('@T10:00:00.000'), 1e-7, 's').toLiteral()).toBe('@T10:00:00.000');
    expect(addCalendar(literal('@T10:00:00.000'), -0, 's').toLiteral()).toBe('@T10:00:00.000');
  });

  it('accepts decimals with a negative scale', () => {
    expect(
      addCalendar(literal('@2014-01-01'), { coefficient: 1n, scale: -1 }, 'days').toLiteral(),
    ).toBe('@2014-01-11');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1e21])(
    'raises eval/datetime-out-of-range for the amount %d',
    (amount) => {
      expect(() => addCalendar(literal('@2014-01-01'), amount, 'days')).toThrow(
        expect.objectContaining({ code: 'eval/datetime-out-of-range' }),
      );
    },
  );

  it('does not change its input', () => {
    const value = literal('@2014-01-31T10:00Z');
    addCalendar(value, 1, 'month');
    expect(value.toLiteral()).toBe('@2014-01-31T10:00Z');
  });
});

describe('date/time arithmetic laws (property-based)', () => {
  // Keep a margin inside 0001–9999 for the largest amounts below (1000 weeks is about 19 years).
  // `Date.UTC` maps the years 0–99 to 1900–1999, so the bounds are built with `setUTCFullYear`.
  const startOfYear = (year: number): number => new Date(0).setUTCFullYear(year, 0, 1);
  const instant = fc
    .integer({ min: startOfYear(100), max: startOfYear(9900) - 1 })
    .map((milliseconds) => new Date(milliseconds).toISOString().slice(0, -1));
  const offset = fc.option(fc.constantFrom('Z', '+14:00', '-14:00', '+05:30'), { nil: '' });
  const fullDateTime = fc.tuple(instant, offset).map(([text, zone]) => literal(`@${text}${zone}`));
  const options = { numRuns: 300 };

  it('undoes an addition of milliseconds with a subtraction', () => {
    fc.assert(
      fc.property(fullDateTime, fc.integer({ min: -1e10, max: 1e10 }), (value, amount) => {
        const there = addCalendar(value, amount, 'ms');
        expect(subtractCalendar(there, amount, 'ms').toLiteral()).toBe(value.toLiteral());
      }),
      options,
    );
  });

  it('moves a value in the direction of the amount', () => {
    fc.assert(
      fc.property(
        fullDateTime,
        fc.integer({ min: -1000, max: 1000 }),
        fc.constantFrom('days', 'hours', 'minutes', 's', 'ms', 'wk'),
        (value, amount, unit) => {
          const moved = addCalendar(value, amount, unit);
          expect(compareTemporal(moved, value)).toBe(Math.sign(amount) + 0);
        },
      ),
      options,
    );
  });

  it('brings a Time back to itself after whole days', () => {
    const time = fc
      .integer({ min: 0, max: 86_399_999 })
      .map((milliseconds) => literal(`@T${new Date(milliseconds).toISOString().slice(11, 23)}`));
    fc.assert(
      fc.property(time, fc.integer({ min: -1000, max: 1000 }), (value, days) => {
        expect(addCalendar(value, days * 24, 'hours').toLiteral()).toBe(value.toLiteral());
      }),
      options,
    );
  });
});
