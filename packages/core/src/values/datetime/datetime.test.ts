import { describe, expect, it } from 'vitest';
import { FhirPathEvaluationError } from '../../errors/fhirpath-error.ts';
import { DateValue } from './date.ts';
import type { DateTimeFields } from './datetime.ts';
import { DateTimeValue } from './datetime.ts';
import { parseTemporalLiteral } from './parse.ts';
import type { TimeValue } from './time.ts';

function literal(text: string): DateValue | DateTimeValue | TimeValue {
  const value = parseTemporalLiteral(text);
  if (value === undefined) {
    throw new Error(`Invalid literal in test: ${text}`);
  }
  return value;
}

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof FhirPathEvaluationError ? error.code : 'not a FhirPathEvaluationError';
  }
  return undefined;
}

describe('DateTimeValue', () => {
  it('is frozen, so it cannot be changed from JavaScript either', () => {
    const value = literal('@2014-01-25T14:30Z');
    expect(Object.isFrozen(value)).toBe(true);
    expect(Reflect.set(value, 'precision', 'year')).toBe(false);
    expect(value.toLiteral()).toBe('@2014-01-25T14:30Z');
  });

  it.each<[DateTimeFields, string]>([
    [{ year: 2014, hour: 10 }, 'a time without a full date'],
    [{ year: 2014, month: 1, offsetMinutes: 60 }, 'an offset without a time'],
    [{ year: 2014, month: 1, day: 1, minute: 0 }, 'a minute without an hour'],
    [{ year: 2014, month: 1, day: 1, hour: 10, offsetMinutes: 841 }, 'an offset beyond +14:00'],
    [{ year: 2014, month: 1, day: 1, hour: 10, offsetMinutes: 1.5 }, 'a fractional offset'],
    [{ year: 2014, month: 1, day: 1, hour: 10, second: 0 }, 'a second without a minute'],
  ])('rejects %j (%s)', (fields) => {
    expect(DateTimeValue.tryCreate(fields)).toBeUndefined();
    expect(codeOf(() => DateTimeValue.create(fields))).toBe('eval/datetime-out-of-range');
  });

  // https://hl7.org/fhirpath/N1/#tostring-string and STU3 toString()
  it.each([
    ['@2020-01-01T10:00:00.000+10:00', '2020-01-01T10:00:00.000+10:00'],
    ['@1974-12-25T14:35:45-05:00', '1974-12-25T14:35:45-05:00'], // testLessThan28
    ['@2014-01-25T14:30:14.559Z', '2014-01-25T14:30:14.559Z'],
    ['@2014-01-25T14:30:14.559+00:00', '2014-01-25T14:30:14.559Z'],
    ['@2014-01-25T14:30', '2014-01-25T14:30'],
    ['@2015-02-04T10Z', '2015-02-04T10Z'],
    ['@2015-02-04T10:00-09:30', '2015-02-04T10:00-09:30'],
    ['@2025-11-01T', '2025-11-01'],
    ['@2014-01T', '2014-01'],
    ['@2014T', '2014'],
  ])('formats %s as %s', (text, expected) => {
    const value = literal(text);
    expect(value).toBeInstanceOf(DateTimeValue);
    expect(value.toString()).toBe(expected);
    expect(value.toJSON()).toBe(expected);
  });

  it.each([
    '@2014-01-25T14:30:14.559Z',
    '@2014-01-25T14:30:14.559-14:00',
    '@2014-01-25T14:30',
    '@2014-03-25T',
    '@2014-01T',
    '@2014T',
  ])('writes %s back as the same literal', (text) => {
    expect(literal(text).toLiteral()).toBe(text);
  });

  it('converts a Date to a DateTime without time components (N1 §5.5 implicit conversion)', () => {
    const date = DateValue.create({ year: 2014, month: 1, day: 25 });
    const dateTime = DateTimeValue.fromDate(date);
    expect(dateTime.toLiteral()).toBe('@2014-01-25T');
    expect(dateTime.precision).toBe('day');
    expect(dateTime.hour).toBeUndefined();
    expect(dateTime.offsetMinutes).toBeUndefined();
  });

  it('takes the date part as written, without converting the timezone (3.0.0 toDate())', () => {
    // https://hl7.org/fhirpath/STU3/ toDate(): @2024-01-15T23:30:00-05:00.toDate() is @2024-01-15
    expect(literal('@2024-01-15T23:30:00-05:00')).toBeInstanceOf(DateTimeValue);
    const value = literal('@2024-01-15T23:30:00-05:00');
    expect(value instanceof DateTimeValue && value.toDateValue().toLiteral()).toBe('@2024-01-15');
    const partial = literal('@2024-01T');
    expect(partial instanceof DateTimeValue && partial.toDateValue().toLiteral()).toBe('@2024-01');
  });
});
