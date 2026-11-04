import { describe, expect, it } from 'vitest';
import { FhirPathEvaluationError } from '../../errors/fhirpath-error.ts';
import type { DateValue } from './date.ts';
import type { DateTimeValue } from './datetime.ts';
import { parseTemporalLiteral } from './parse.ts';
import type { TimeFields } from './time.ts';
import { TimeValue } from './time.ts';

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

describe('TimeValue', () => {
  it('is frozen, so it cannot be changed from JavaScript either', () => {
    const value = literal('@T14:30');
    expect(Object.isFrozen(value)).toBe(true);
    expect(Reflect.set(value, 'precision', 'year')).toBe(false);
    expect(value.toLiteral()).toBe('@T14:30');
  });

  it.each<[TimeFields, string]>([
    [{ hour: 14, second: 1 }, 'a second without a minute'],
    [{ hour: 14, minute: 0, millisecond: 1 }, 'a millisecond without a second'],
    [{ hour: 24 }, 'hour 24'],
    [{ hour: -1 }, 'hour -1'],
    [{ hour: 1, minute: 0, second: 0, millisecond: 1000 }, 'millisecond 1000'],
  ])('rejects %j (%s)', (fields) => {
    expect(TimeValue.tryCreate(fields)).toBeUndefined();
    expect(codeOf(() => TimeValue.create(fields))).toBe('eval/datetime-out-of-range');
  });

  // https://hl7.org/fhirpath/STU3/ toString(): `@T10:30:00.000.toString()` is `10:30:00.000`
  it.each([
    ['@T10:30:00.000', '10:30:00.000'],
    ['@T11:45', '11:45'],
    ['@T14', '14'],
    ['@T14:34:28.1', '14:34:28.100'],
  ])('formats %s as %s', (text, expected) => {
    const value = literal(text);
    expect(value.toString()).toBe(expected);
    expect(value.toJSON()).toBe(expected);
    expect(value.toLiteral()).toBe(`@T${expected}`);
  });
});
