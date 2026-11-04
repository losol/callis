import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  civilFromDays,
  daysFromCivil,
  daysInMonth,
  isLeapYear,
  MAX_YEAR,
  MIN_YEAR,
  wallClockMilliseconds,
} from './calendar.ts';

describe('isLeapYear', () => {
  it.each([
    [2016, true],
    [2015, false],
    [2000, true], // divisible by 400
    [1900, false], // divisible by 100 but not 400
    [2400, true],
    [4, true],
    [1, false],
  ])('%i → %s', (year, expected) => {
    expect(isLeapYear(year)).toBe(expected);
  });
});

describe('daysInMonth', () => {
  it.each([
    [2020, 1, 31],
    [2020, 2, 29],
    [2021, 2, 28],
    [2021, 4, 30],
    [2021, 12, 31],
  ])('%i-%i has %i days', (year, month, expected) => {
    expect(daysInMonth(year, month)).toBe(expected);
  });
});

describe('daysFromCivil and civilFromDays', () => {
  it.each([
    [1970, 1, 1, 0],
    [1970, 1, 2, 1],
    [1969, 12, 31, -1],
    [2000, 3, 1, 11017],
    [1, 1, 1, -719162],
    [9999, 12, 31, 2932896],
  ])('%i-%i-%i is day %i', (year, month, day, days) => {
    expect(daysFromCivil(year, month, day)).toBe(days);
    expect(civilFromDays(days)).toEqual({ year, month, day });
  });

  it('agrees with the UTC methods of Date', () => {
    expect(wallClockMilliseconds(2017, 11, 5, 1, 30, 15, 123)).toBe(
      Date.UTC(2017, 10, 5, 1, 30, 15, 123),
    );
  });

  it('round-trips every day in the supported range', () => {
    const first = daysFromCivil(MIN_YEAR, 1, 1);
    const last = daysFromCivil(MAX_YEAR, 12, 31);
    fc.assert(
      fc.property(fc.integer({ min: first, max: last }), (days) => {
        const date = civilFromDays(days);
        expect(date.day).toBeLessThanOrEqual(daysInMonth(date.year, date.month));
        expect(daysFromCivil(date.year, date.month, date.day)).toBe(days);
      }),
      { numRuns: 1000 },
    );
  });
});
