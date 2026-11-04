import { describe, expect, it } from 'vitest';
import { FhirPathEvaluationError } from '../../errors/fhirpath-error.ts';
import type { DateFields } from './date.ts';
import { DateValue } from './date.ts';
import type { DateTimeValue } from './datetime.ts';
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

describe('DateValue', () => {
  it('is frozen, so it cannot be changed from JavaScript either', () => {
    const value = literal('@2014-01-25');
    expect(Object.isFrozen(value)).toBe(true);
    expect(Reflect.set(value, 'precision', 'year')).toBe(false);
    expect(value.toLiteral()).toBe('@2014-01-25');
  });

  it('derives the precision from the components', () => {
    expect(DateValue.create({ year: 2014 }).precision).toBe('year');
    expect(DateValue.create({ year: 2014, month: 1 }).precision).toBe('month');
    expect(DateValue.create({ year: 2014, month: 1, day: 25 }).precision).toBe('day');
  });

  it.each<[DateFields, string]>([
    [{ year: 2014, day: 1 }, 'a day without a month'],
    [{ year: 2014.5 }, 'a fractional year'],
    [{ year: 10000 }, 'year 10000'],
    [{ year: 2014, month: 2, day: 29 }, 'February 29 in a common year'],
    [{ year: Number.NaN }, 'NaN'],
  ])('rejects %j (%s)', (fields) => {
    expect(DateValue.tryCreate(fields)).toBeUndefined();
    expect(codeOf(() => DateValue.create(fields))).toBe('eval/datetime-out-of-range');
  });

  // https://hl7.org/fhirpath/N1/#tostring-string
  it.each([
    ['@2014-12-14', '2014-12-14'], // testToString5
    ['@2014-01', '2014-01'],
    ['@2014', '2014'],
    ['@0001-01-01', '0001-01-01'],
  ])('formats %s as %s', (text, expected) => {
    const value = literal(text);
    expect(value.toString()).toBe(expected);
    expect(value.toJSON()).toBe(expected);
    expect(JSON.stringify({ value })).toBe(`{"value":"${expected}"}`);
    expect(value.toLiteral()).toBe(text);
  });
});
