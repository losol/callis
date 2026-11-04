import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FhirPathEvaluationError } from '../../errors/fhirpath-error.ts';
import { daysInMonth } from './calendar.ts';
import { compareTemporal, temporalEquals, temporalEquivalent } from './compare.ts';
import { DateValue } from './date.ts';
import { DateTimeValue } from './datetime.ts';
import { parseTemporalLiteral } from './parse.ts';
import type { Precision } from './precision.ts';
import type { TemporalValue } from './temporal-value.ts';
import { TimeValue } from './time.ts';

function literal(text: string): TemporalValue {
  const value = parseTemporalLiteral(text);
  if (value === undefined) {
    throw new Error(`Invalid literal in test: ${text}`);
  }
  return value;
}

/**
 * Evaluates `<literal> <operator> <literal>` with the kernels, mapping each operator the way the
 * runtime will (T0009/T0010). `undefined` stands for an empty result.
 */
function evaluate(expression: string, defaultOffsetMinutes = 0): boolean | undefined {
  const match = /^(\S+)\s+(=|!=|~|!~|<|<=|>|>=)\s+(\S+)$/.exec(expression);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`Malformed test expression: ${expression}`);
  }
  const left = literal(match[1]);
  const right = literal(match[3]);
  const order = (): number | undefined => compareTemporal(left, right, defaultOffsetMinutes);
  const equal = temporalEquals(left, right, defaultOffsetMinutes);
  switch (match[2]) {
    case '=':
      return equal;
    case '!=':
      return equal === undefined ? undefined : !equal;
    case '~':
      return temporalEquivalent(left, right, defaultOffsetMinutes);
    case '!~':
      return !temporalEquivalent(left, right, defaultOffsetMinutes);
    default: {
      const result = order();
      if (result === undefined) {
        return undefined;
      }
      switch (match[2]) {
        case '<':
          return result < 0;
        case '<=':
          return result <= 0;
        case '>':
          return result > 0;
        default:
          return result >= 0;
      }
    }
  }
}

type Row = readonly [expression: string, expected: boolean | undefined];

describe('date/time equality', () => {
  // https://hl7.org/fhirpath/N1/#datetime-equality (same examples in 3.0.0)
  it.each<Row>([
    ['@2012 = @2012', true],
    ['@2012 = @2013', false],
    ['@2012-01 = @2012', undefined],
    ['@2012-01-01T10:30 = @2012-01-01T10:30', true],
    ['@2012-01-01T10:30 = @2012-01-01T10:31', false],
    ['@2012-01-01T10:30:31 = @2012-01-01T10:30', undefined],
    ['@2012-01-01T10:30:31.0 = @2012-01-01T10:30:31', true],
    ['@2012-01-01T10:30:31.1 = @2012-01-01T10:30:31', false],
    ['@2017-11-05T01:30:00.0-04:00 = @2017-11-05T01:15:00.0-05:00', false],
    ['@2017-11-05T01:30:00.0-04:00 = @2017-11-05T00:30:00.0-05:00', true],
  ])('%s → %s (N1 Date/Time equality)', (expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });

  // HL7 test suite: testEquality*, testNEquality*, testLiteral*, testDistinct*, testUnion13
  it.each<Row>([
    ['@2012-04-15 = @2012-04-15', true], // testEquality17
    ['@2012-04-15 = @2012-04-16', false], // testEquality18
    ['@2012-04-15 = @2012-04-15T10:00:00', undefined], // testEquality19
    ['@2012-04-15T15:00:00 = @2012-04-15T10:00:00', false], // testEquality20
    ['@2012-04-15T15:30:31 = @2012-04-15T15:30:31.0', true], // testEquality21
    ['@2012-04-15T15:30:31 = @2012-04-15T15:30:31.1', false], // testEquality22
    ['@2012-04-15T15:00:00+02:00 = @2012-04-15T16:00:00+03:00', true], // testEquality24
    ['@2015-02-04T10:00 = @2015-02-04T10:00', true], // testEquality37
    ['@2015-02-04T10:00 = @2015-02-04T11:00', false], // testEquality38
    ['@2015-02-04T10:00:00 = @2015-02-04T10:00', undefined], // testEquality39
    ['@2015-02-04T10:00-05:00 = @2015-02-04T10:00-05:00', true], // testEquality40
    ['@2012-04-15 != @2012-04-15', false], // testNEquality11
    ['@2012-04-15 != @2012-04-16', true], // testNEquality12
    ['@2012-04-15 != @2012-04-15T10:00:00', undefined], // testNEquality13
    ['@2012-04-15T15:00:00 != @2012-04-15T10:00:00', true], // testNEquality14
    ['@2012-04-15T15:30:31 != @2012-04-15T15:30:31.0', false], // testNEquality15
    ['@2012-04-15T15:30:31 != @2012-04-15T15:30:31.1', true], // testNEquality16
    ['@2012-04-15T15:00:00+02:00 != @2012-04-15T16:00:00+03:00', false], // testNEquality18
    ['@2015-02-04T10:00 != @2015-02-04T11:00', true], // testNEquality27
    ['@1974-12-25 = @1974-12-25', true], // testDateEqual (birthDate as a literal)
    ['@1974-12-25 != @1974-12-25T12:34:00', undefined], // testDateNotEqual
    ['@1974-12-25 != @1974-12-25T12:34:00-10:00', undefined], // testDateNotEqualTimezoneOffsetBefore
    ['@1974-12-25 != @1974-12-25T12:34:00+10:00', undefined], // testDateNotEqualTimezoneOffsetAfter
    ['@1974-12-25 != @1974-12-25T12:34:00Z', undefined], // testDateNotEqualUTC
    ['@1974-12-25 != @T12:14:15', true], // testDateNotEqualTimeSecond
    ['@1974-12-25 != @T12:14', true], // testDateNotEqualTimeMinute
    ['@2017-11-05T01:30:00.0-04:00 = @2017-11-05T01:15:00.0-05:00', false], // testLiteralDateTimeTZEqualFalse
    ['@2017-11-05T01:30:00.0-04:00 = @2017-11-05T00:30:00.0-05:00', true], // testLiteralDateTimeTZEqualTrue
    ['@2020-01-01T10:00:00+10:00 = @2020-01-01T00:00:00Z', true], // testDistinct28
    ['@2020 = @2020-01-01', undefined], // testDistinct29
    ['@T10:00:00 = @T10:00:00', true], // testDistinct18
    ['@T10:00:00 = @T11:00:00', false], // testDistinct17
  ])('%s → %s', (expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });

  it('treats a Date and a DateTime with the same date as equal (implicit Date → DateTime)', () => {
    expect(evaluate('@2012-04-15 = @2012-04-15T')).toBe(true);
    expect(evaluate('@2012-04-15 ~ @2012-04-15T')).toBe(true);
    expect(evaluate('@2012-04 = @2012-04T')).toBe(true);
  });

  it('never equates a Time with a Date or DateTime', () => {
    expect(temporalEquals(literal('@T10:00'), literal('@2012-04-15T10:00'))).toBe(false);
    expect(temporalEquivalent(literal('@2012-04-15'), literal('@T10:00'))).toBe(false);
  });
});

describe('date/time equivalence', () => {
  // https://hl7.org/fhirpath/N1/#datetime-equivalence (same examples in 3.0.0)
  it.each<Row>([
    ['@2012 ~ @2012', true],
    ['@2012 ~ @2013', false],
    ['@2012-01 ~ @2012', false],
    ['@2012-01-01T10:30 ~ @2012-01-01T10:30', true],
    ['@2012-01-01T10:30 ~ @2012-01-01T10:31', false],
    ['@2012-01-01T10:30:31 ~ @2012-01-01T10:30', false],
    ['@2012-01-01T10:30:31.0 ~ @2012-01-01T10:30:31', true],
    ['@2012-01-01T10:30:31.1 ~ @2012-01-01T10:30:31', false],
  ])('%s → %s (N1 Date/Time equivalence)', (expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });

  // HL7 test suite: testEquivalent*, testNotEquivalent*
  it.each<Row>([
    ['@2012-04-15 ~ @2012-04-15', true], // testEquivalent14
    ['@2012-04-15 ~ @2012-04-16', false], // testEquivalent15
    ['@2012-04-15 ~ @2012-04-15T10:00:00', false], // testEquivalent16
    ['@2012-04-15T15:30:31 ~ @2012-04-15T15:30:31.0', true], // testEquivalent17
    ['@2012-04-15T15:30:31 ~ @2012-04-15T15:30:31.1', false], // testEquivalent18
    ['@2015-02-04T10:00 ~ @2015-02-04T10:00', true], // testEquivalent31
    ['@2012-04-15 !~ @2012-04-15', false], // testNotEquivalent14
    ['@2012-04-15 !~ @2012-04-16', true], // testNotEquivalent15
    ['@2012-04-15 !~ @2012-04-15T10:00:00', true], // testNotEquivalent16
    ['@2012-04-15T15:30:31 !~ @2012-04-15T15:30:31.0', false], // testNotEquivalent17
    ['@2012-04-15T15:30:31 !~ @2012-04-15T15:30:31.1', true], // testNotEquivalent18
  ])('%s → %s', (expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });
});

describe('date/time comparison', () => {
  // https://hl7.org/fhirpath/N1/#comparison, including the examples 3.0.0 adds
  it.each<Row>([
    ['@2018-03-01 > @2018-01-01', true],
    ['@2018-03 > @2018-03-01', undefined],
    ['@2018-03-01T10:30:00 > @2018-03-01T10:00:00', true],
    ['@2018-03-01T10 > @2018-03-01T10:30', undefined],
    ['@2018-03-01T10:30:00 > @2018-03-01T10:30:00.0', false],
    ['@T10:30:00 > @T10:00:00', true],
    ['@T10 > @T10:30', undefined],
    ['@T10:30:00 > @T10:30:00.0', false],
    ['@2018-03-01 < @2018-01-01', false],
    ['@2018-01-01 < @2018-01-01', false],
    ['@2018-03 < @2018-03-01', undefined],
    ['@2018-03-01T10:30:00 < @2018-03-01T10:00:00', false],
    ['@2018-03-01T10 < @2018-03-01T10:30', undefined],
    ['@2018-03-01T10:30:00 < @2018-03-01T10:30:00.0', false],
    ['@2018-01-01T16:00:00+11:00 < @2018-01-01T15:00:00.0+10:00', false],
    ['@2018-01-01T16:00:00+12:00 < @2018-01-01T15:00:00.0+10:00', true],
    ['@T10:30:00 < @T10:00:00', false],
    ['@T10 < @T10:30', undefined],
    ['@T10:30:00 < @T10:30:00.0', false],
    ['@2018-03-01 <= @2018-01-01', false],
    ['@2018-01-01 <= @2018-01-01', true],
    ['@2018-03 <= @2018-03-01', undefined],
    ['@2018-03-01T10:30:00 <= @2018-03-01T10:00:00', false],
    ['@2018-03-01T10 <= @2018-03-01T10:30', undefined],
    ['@2018-03-01T10:30:00 <= @2018-03-01T10:30:00.0', true],
    ['@2018-01-01T16:00:00+11:00 <= @2018-01-01T15:00:00.0+10:00', true],
    ['@T10:30:00 <= @T10:00:00', false],
    ['@T10 <= @T10:30', undefined],
    ['@T10:30:00 <= @T10:30:00.0', true],
    ['@2018-03-01 >= @2018-01-01', true],
    ['@2018-01-01 >= @2018-01-01', true],
    ['@2018-03 >= @2018-03-01', undefined],
    ['@2018-03-01T10:30:00 >= @2018-03-01T10:00:00', true],
    ['@2018-03-01T10 >= @2018-03-01T10:30', undefined],
    ['@2018-03-01T10:30:00 >= @2018-03-01T10:30:00.0', true],
    ['@T10:30:00 >= @T10:00:00', true],
    ['@T10 >= @T10:30', undefined],
    ['@T10:30:00 >= @T10:30:00.0', true],
    // https://hl7.org/fhirpath/N1/#datetime-equality: comparison respects offsets
    ['@2017-11-05T01:30:00.0-04:00 > @2017-11-05T01:15:00.0-05:00', false],
    ['@2017-11-05T01:30:00.0-04:00 < @2017-11-05T01:15:00.0-05:00', true],
  ])('%s → %s (N1 §6.2)', (expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });

  // HL7 test suite: testLessThan*, testLessOrEqual*, testGreatorOrEqual*, testGreaterThan*
  it.each<Row>([
    ['@2014-12-12 < @2014-12-13', true], // testLessThan5
    ['@2014-12-13T12:00:00 < @2014-12-13T12:00:01', true], // testLessThan6
    ['@T12:00:00 < @T14:00:00', true], // testLessThan7
    ['@2014-12-12 < @2014-12-12', false], // testLessThan12
    ['@2014-12-13T12:00:00 < @2014-12-13T12:00:00', false], // testLessThan13
    ['@T12:00:00 < @T12:00:00', false], // testLessThan14
    ['@2014-12-13 < @2014-12-12', false], // testLessThan19
    ['@2014-12-13T12:00:01 < @2014-12-13T12:00:00', false], // testLessThan20
    ['@T12:00:01 < @T12:00:00', false], // testLessThan21
    ['@2018-03 < @2018-03-01', undefined], // testLessThan23
    ['@2018-03-01T10:30 < @2018-03-01T10:30:00', undefined], // testLessThan24
    ['@T10:30 < @T10:30:00', undefined], // testLessThan25
    ['@2018-03-01T10:30:00 < @2018-03-01T10:30:00.0', false], // testLessThan26
    ['@T10:30:00 < @T10:30:00.0', false], // testLessThan27
    ['@1974-12-25T14:35:45-05:00 < @1975-01-01T00:00:00Z', true], // testLessThan28
    ['@2014-12-12 <= @2014-12-13', true], // testLessOrEqual5
    ['@2014-12-13T12:00:00 <= @2014-12-13T12:00:01', true], // testLessOrEqual6
    ['@T12:00:00 <= @T14:00:00', true], // testLessOrEqual7
    ['@2014-12-12 <= @2014-12-12', true], // testLessOrEqual12
    ['@2014-12-13T12:00:00 <= @2014-12-13T12:00:00', true], // testLessOrEqual13
    ['@T12:00:00 <= @T12:00:00', true], // testLessOrEqual14
    ['@2014-12-13 <= @2014-12-12', false], // testLessOrEqual19
    ['@2014-12-13T12:00:01 <= @2014-12-13T12:00:00', false], // testLessOrEqual20
    ['@T12:00:01 <= @T12:00:00', false], // testLessOrEqual21
    ['@2018-03 <= @2018-03-01', undefined], // testLessOrEqual23
    ['@2018-03-01T10:30 <= @2018-03-01T10:30:00', undefined], // testLessOrEqual24
    ['@T10:30 <= @T10:30:00', undefined], // testLessOrEqual25
    ['@2018-03-01T10:30:00 <= @2018-03-01T10:30:00.0', true], // testLessOrEqual26
    ['@T10:30:00 <= @T10:30:00.0', true], // testLessOrEqual27
    ['@2014-12-12 >= @2014-12-13', false], // testGreatorOrEqual5
    ['@2014-12-13T12:00:00 >= @2014-12-13T12:00:01', false], // testGreatorOrEqual6
    ['@T12:00:00 >= @T14:00:00', false], // testGreatorOrEqual7
    ['@2014-12-12 >= @2014-12-12', true], // testGreatorOrEqual12
    ['@2014-12-13T12:00:00 >= @2014-12-13T12:00:00', true], // testGreatorOrEqual13
    ['@T12:00:00 >= @T12:00:00', true], // testGreatorOrEqual14
    ['@2014-12-13 >= @2014-12-12', true], // testGreatorOrEqual19
    ['@2014-12-13T12:00:01 >= @2014-12-13T12:00:00', true], // testGreatorOrEqual20
    ['@T12:00:01 >= @T12:00:00', true], // testGreatorOrEqual21
    ['@2018-03 >= @2018-03-01', undefined], // testGreatorOrEqual23
    ['@2018-03-01T10:30 >= @2018-03-01T10:30:00', undefined], // testGreatorOrEqual24
    ['@T10:30 >= @T10:30:00', undefined], // testGreatorOrEqual25
    ['@2018-03-01T10:30:00 >= @2018-03-01T10:30:00.0', true], // testGreatorOrEqual26
    ['@T10:30:00 >= @T10:30:00.0', true], // testGreatorOrEqual27
    ['@2014-12-12 > @2014-12-13', false], // testGreaterThan5
    ['@2014-12-13T12:00:00 > @2014-12-13T12:00:01', false], // testGreaterThan6
    ['@T12:00:00 > @T14:00:00', false], // testGreaterThan7
    ['@2014-12-12 > @2014-12-12', false], // testGreaterThan12
    ['@2014-12-13T12:00:00 > @2014-12-13T12:00:00', false], // testGreaterThan13
    ['@T12:00:00 > @T12:00:00', false], // testGreaterThan14
    ['@2014-12-13 > @2014-12-12', true], // testGreaterThan19
    ['@2014-12-13T12:00:01 > @2014-12-13T12:00:00', true], // testGreaterThan20
    ['@T12:00:01 > @T12:00:00', true], // testGreaterThan21
    ['@2018-03 > @2018-03-01', undefined], // testGreaterThan23
    ['@2018-03-01T10:30 > @2018-03-01T10:30:00', undefined], // testGreaterThan24
    ['@T10:30 > @T10:30:00', undefined], // testGreaterThan25
    ['@2018-03-01T10:30:00 > @2018-03-01T10:30:00.0', false], // testGreaterThan26
    ['@T10:30:00 > @T10:30:00.0', false], // testGreaterThan27
    ['@2017-11-05T01:30:00.0-04:00 > @2017-11-05T01:15:00.0-05:00', false], // testLiteralDateTimeTZGreater
    ['@2017-11-05T01:30:00.0-04:00 < @2017-11-05T01:15:00.0-05:00', true], // testLiteralDateTimeTZLess
    // period/testPeriodInvariantOld: a day-precision start against a full end is unknown
    ['@2001-05-06T <= @2001-05-06T10:10:10Z', undefined],
  ])('%s → %s', (expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });

  it.each<Row>([
    // A difference in a coarser component decides, even if the precisions differ.
    ['@2018 < @2019-01-01', true],
    ['@2018-03 < @2018-04-01', true],
    ['@2018-12 < @2019-01', true],
    ['@2018-12 = @2018-12-31T23:59', undefined],
    ['@2018-03-01T10 > @2018-03-01T09:59:59.999', true],
    ['@T10 < @T11:00', true],
    ['@T10:00:00.001 > @T10:00:00', true],
    ['@0001-01-01 < @9999-12-31T23:59:59.999', true],
    ['@2016-02-29 < @2016-03-01', true],
  ])('%s → %s (components compared from the year down)', (expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });

  it('raises eval/type-mismatch when a Time is compared with a Date or DateTime (N1 §6.2)', () => {
    for (const [left, right] of [
      ['@T10:00', '@2018-03-01T10:00'],
      ['@2018-03-01', '@T10:00'],
    ] as const) {
      expect(() => compareTemporal(literal(left), literal(right))).toThrow(
        expect.objectContaining({ code: 'eval/type-mismatch' }),
      );
      expect(() => compareTemporal(literal(left), literal(right))).toThrow(FhirPathEvaluationError);
    }
  });
});

describe('timezone offsets', () => {
  it.each<Row>([
    // ±14:00 and Z
    ['@2012-04-15T00:00+14:00 = @2012-04-14T10:00Z', true],
    ['@2012-04-14T10:00-14:00 = @2012-04-15T00:00Z', true],
    ['@2012-04-15T00:00+14:00 < @2012-04-14T10:00-14:00', true],
    ['@2012-04-15T00:00:00.000+14:00 = @2012-04-14T10:00:00.000-00:00', true],
    ['@2012-04-15T10:00Z = @2012-04-15T10:00+00:00', true],
    ['@2012-04-15T10:00Z ~ @2012-04-15T10:00+00:00', true],
    // Normalizing to UTC can move a value to another day, month or year.
    ['@2013-01-01T01:00+02:00 = @2012-12-31T23:00Z', true],
    ['@2013-01-01T01:00+02:00 < @2013-01-01T00:00Z', true],
    // An offset that is not a whole number of hours moves an hour-precision value off the hour
    // grid, so it is only certain where the spans do not overlap.
    ['@2015-02-04T10+05:30 = @2015-02-04T11+06:30', true],
    ['@2015-02-04T10+05:30 = @2015-02-04T04Z', undefined],
    ['@2015-02-04T10+05:30 = @2015-02-04T04:30Z', undefined],
    ['@2015-02-04T10+05:30 > @2015-02-04T04:29Z', true],
    ['@2015-02-04T10+05:30 < @2015-02-04T05:30Z', true],
  ])('%s → %s', (expression, expected) => {
    expect(evaluate(expression)).toBe(expected);
  });

  it('treats a value without an offset as UTC by default (ADR-0012)', () => {
    // testEquality23 expects empty here; Callis follows ADR-0012 (see docs/spec-notes.md).
    expect(evaluate('@2012-04-15T15:00:00Z = @2012-04-15T10:00:00')).toBe(false);
    expect(evaluate('@2012-04-15T15:00:00Z != @2012-04-15T10:00:00')).toBe(true); // testNEquality17
    expect(evaluate('@2012-04-15T10:00:00Z = @2012-04-15T10:00:00')).toBe(true);
  });

  it('applies the default offset to the value without one', () => {
    expect(evaluate('@2012-04-15T15:00:00Z = @2012-04-15T10:00:00', -300)).toBe(true);
    expect(evaluate('@2012-04-15T10:00:00Z = @2012-04-15T10:00:00', 60)).toBe(false);
    expect(evaluate('@2012-04-15T10:00:00Z > @2012-04-15T10:00:00', 60)).toBe(true);
    expect(evaluate('@2012-04-15T10:00:00+14:00 = @2012-04-15T10:00:00', 840)).toBe(true);
  });

  it('applies the default offset to a Date compared with a DateTime that has an offset', () => {
    // At UTC, 2012-04-15 runs from 04-15T00:00Z; the instant 04-14T15:00Z is the day before.
    expect(evaluate('@2012-04-15 = @2012-04-15T01:00+10:00')).toBe(false);
    expect(evaluate('@2012-04-15 > @2012-04-15T01:00+10:00')).toBe(true);
    // At +10:00, the same instant falls on 2012-04-15, so only the precision differs.
    expect(evaluate('@2012-04-15 = @2012-04-15T01:00+10:00', 600)).toBeUndefined();
  });

  it('compares values without offsets as written, whatever the default offset', () => {
    for (const offset of [-840, -300, 0, 330, 840]) {
      expect(evaluate('@2012-04-15T10:00 < @2012-04-15T11:00', offset)).toBe(true);
      expect(evaluate('@2012-04-15 = @2012-04-15', offset)).toBe(true);
      expect(evaluate('@2012-04-15 = @2012-04-15T10:00', offset)).toBeUndefined();
    }
  });
});

describe('comparison laws (property-based)', () => {
  const precisions: readonly Precision[] = [
    'year',
    'month',
    'day',
    'hour',
    'minute',
    'second',
    'millisecond',
  ];
  const timePrecisions = ['hour', 'minute', 'second', 'millisecond'] as const;

  // Narrow ranges make equal, overlapping and adjacent values common.
  const components = {
    year: fc.integer({ min: 1999, max: 2000 }),
    month: fc.constantFrom(1, 2, 12),
    day: fc.constantFrom(1, 28, 29, 31),
    hour: fc.constantFrom(0, 1, 10, 23),
    minute: fc.constantFrom(0, 30, 59),
    second: fc.constantFrom(0, 59),
    millisecond: fc.constantFrom(0, 1, 999),
  };

  const dateLikeWith = (offsets: readonly number[]): fc.Arbitrary<DateValue | DateTimeValue> =>
    fc
      .record({
        ...components,
        precision: fc.constantFrom(...precisions),
        offsetMinutes: fc.option(fc.constantFrom(...offsets), { nil: undefined }),
        asDate: fc.boolean(),
      })
      .map((fields): DateValue | DateTimeValue => {
        const level = precisions.indexOf(fields.precision);
        const at = (component: Precision, value: number): number | undefined =>
          precisions.indexOf(component) <= level ? value : undefined;
        const day = Math.min(fields.day, daysInMonth(fields.year, fields.month));
        if (fields.asDate && level <= 2) {
          return DateValue.create({
            year: fields.year,
            month: at('month', fields.month),
            day: at('day', day),
          });
        }
        return DateTimeValue.create({
          year: fields.year,
          month: at('month', fields.month),
          day: at('day', day),
          hour: at('hour', fields.hour),
          minute: at('minute', fields.minute),
          second: at('second', fields.second),
          millisecond: at('millisecond', fields.millisecond),
          offsetMinutes: level >= 3 ? fields.offsetMinutes : undefined,
        });
      });
  const dateLike = dateLikeWith([-840, -300, 0, 330, 840]);

  const time = fc
    .record({ ...components, precision: fc.constantFrom(...timePrecisions) })
    .map((fields) => {
      const level = timePrecisions.indexOf(fields.precision);
      return TimeValue.create({
        hour: fields.hour,
        minute: level >= 1 ? fields.minute : undefined,
        second: level >= 2 ? fields.second : undefined,
        millisecond: level >= 3 ? fields.millisecond : undefined,
      });
    });

  const defaultOffset = fc.constantFrom(-300, 0, 600);
  const options = { numRuns: 500 };
  const sign = (order: number | undefined): number | undefined =>
    order === undefined ? undefined : Math.sign(order) + 0;

  for (const [name, values] of [
    ['Date and DateTime', dateLike],
    ['Time', time],
  ] as const) {
    describe(name, () => {
      it('is reflexive', () => {
        fc.assert(
          fc.property(values, defaultOffset, (a, offset) => {
            expect(compareTemporal(a, a, offset)).toBe(0);
          }),
          options,
        );
      });

      it('is antisymmetric', () => {
        fc.assert(
          fc.property(values, values, defaultOffset, (a, b, offset) => {
            const forward = compareTemporal(a, b, offset);
            const backward = compareTemporal(b, a, offset);
            expect(sign(forward)).toBe(sign(backward === undefined ? undefined : -backward));
          }),
          options,
        );
      });

      it('is transitive', () => {
        fc.assert(
          fc.property(values, values, values, defaultOffset, (a, b, c, offset) => {
            const ab = compareTemporal(a, b, offset);
            const bc = compareTemporal(b, c, offset);
            if (ab === undefined || bc === undefined) {
              return;
            }
            const ac = compareTemporal(a, c, offset);
            if (ab <= 0 && bc <= 0) {
              expect(ac).toBeDefined();
              expect(ac).toBeLessThanOrEqual(0);
              if (ab < 0 || bc < 0) {
                expect(ac).toBe(-1);
              }
            }
            if (ab >= 0 && bc >= 0) {
              expect(ac).toBeGreaterThanOrEqual(0);
            }
          }),
          options,
        );
      });

      it('agrees with equality: 0 is true, ±1 is false, undefined is empty', () => {
        fc.assert(
          fc.property(values, values, defaultOffset, (a, b, offset) => {
            const order = compareTemporal(a, b, offset);
            expect(temporalEquals(a, b, offset)).toBe(
              order === undefined ? undefined : order === 0,
            );
          }),
          options,
        );
      });

      it('has a = b ⇒ a ~ b when both have the same precision', () => {
        fc.assert(
          fc.property(values, values, defaultOffset, (a, b, offset) => {
            if (a.precision === b.precision && temporalEquals(a, b, offset) === true) {
              expect(temporalEquivalent(a, b, offset)).toBe(true);
            }
          }),
          options,
        );
      });

      it('makes equivalence symmetric and never empty', () => {
        fc.assert(
          fc.property(values, values, defaultOffset, (a, b, offset) => {
            const result = temporalEquivalent(a, b, offset);
            expect(typeof result).toBe('boolean');
            expect(temporalEquivalent(b, a, offset)).toBe(result);
          }),
          options,
        );
      });
    });
  }

  describe('agreement with the component-by-component rule of N1', () => {
    // https://hl7.org/fhirpath/N1/#datetime-equality, taken literally: values with an offset are
    // normalized to UTC (here with Date's UTC methods, independently of calendar.ts), then the
    // components are compared from the year down, with seconds and milliseconds as one decimal.
    // Whole-hour offsets and the default offset 0 keep every value on its own precision's grid,
    // which is where the literal rule is well defined.
    const seconds = (second: number | undefined, millisecond: number | undefined) =>
      second === undefined ? undefined : second * 1000 + (millisecond ?? 0);

    const componentsInUtc = (value: TemporalValue): readonly (number | undefined)[] => {
      if (value instanceof TimeValue) {
        return [value.hour, value.minute, seconds(value.second, value.millisecond)];
      }
      if (value instanceof DateValue || value.offsetMinutes === undefined) {
        const time = value instanceof DateTimeValue ? value : undefined;
        return [
          value.year,
          value.month,
          value.day,
          time?.hour,
          time?.minute,
          seconds(time?.second, time?.millisecond),
        ];
      }
      const local = new Date(0);
      local.setUTCFullYear(value.year, (value.month ?? 1) - 1, value.day ?? 1);
      local.setUTCHours(value.hour ?? 0, value.minute ?? 0, value.second ?? 0, 0);
      const utc = new Date(local.getTime() - value.offsetMinutes * 60_000);
      return [
        utc.getUTCFullYear(),
        utc.getUTCMonth() + 1,
        utc.getUTCDate(),
        utc.getUTCHours(),
        value.minute === undefined ? undefined : utc.getUTCMinutes(),
        seconds(value.second === undefined ? undefined : utc.getUTCSeconds(), value.millisecond),
      ];
    };

    const componentWalk = (a: TemporalValue, b: TemporalValue): number | undefined => {
      const left = componentsInUtc(a);
      const right = componentsInUtc(b);
      for (let index = 0; index < left.length; index++) {
        const x = left[index];
        const y = right[index];
        if (x === undefined || y === undefined) {
          return x === y ? 0 : undefined;
        }
        if (x !== y) {
          return x < y ? -1 : 1;
        }
      }
      return 0;
    };

    for (const [name, values] of [
      ['Date and DateTime', dateLikeWith([-840, -300, -60, 0, 60, 600, 840])],
      ['Time', time],
    ] as const) {
      it(`gives the same result for ${name}`, () => {
        fc.assert(
          fc.property(values, values, (a, b) => {
            expect(compareTemporal(a, b)).toBe(componentWalk(a, b));
          }),
          { numRuns: 3000 },
        );
      });
    }
  });
});
