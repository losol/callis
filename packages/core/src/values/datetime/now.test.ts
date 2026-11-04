import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addCalendar, subtractCalendar } from './arithmetic.ts';
import { compareTemporal, temporalEquals, temporalEquivalent } from './compare.ts';
import { resolveTimezoneOffset, takeNowSnapshot } from './now.ts';
import { parseDate, parseDateTime, parseTemporalLiteral, parseTime } from './parse.ts';
import type { TemporalValue } from './temporal-value.ts';

function literal(text: string): TemporalValue {
  const value = parseTemporalLiteral(text);
  if (value === undefined) {
    throw new Error(`Invalid literal in test: ${text}`);
  }
  return value;
}

function utc(text: string): Date {
  return new Date(Date.parse(text));
}

function snapshotLiterals(at: Date, offsetMinutes: number): readonly string[] {
  const snapshot = takeNowSnapshot(at, offsetMinutes);
  return [snapshot.now.toLiteral(), snapshot.today.toLiteral(), snapshot.timeOfDay.toLiteral()];
}

describe('takeNowSnapshot', () => {
  // https://hl7.org/fhirpath/N1/#current-date-and-time-functions; ADR-0012 (UTC by default)
  it.each([
    ['2026-11-04T21:05:09.007Z', 0, ['@2026-11-04T21:05:09.007Z', '@2026-11-04', '@T21:05:09.007']],
    [
      '2026-11-04T21:05:09.007Z',
      840,
      ['@2026-11-05T11:05:09.007+14:00', '@2026-11-05', '@T11:05:09.007'],
    ],
    [
      '2026-11-04T21:05:09.007Z',
      -840,
      ['@2026-11-04T07:05:09.007-14:00', '@2026-11-04', '@T07:05:09.007'],
    ],
    [
      '2026-01-01T03:00:00.000Z',
      -300,
      ['@2025-12-31T22:00:00.000-05:00', '@2025-12-31', '@T22:00:00.000'],
    ],
    [
      '2024-02-29T23:59:59.999Z',
      60,
      ['@2024-03-01T00:59:59.999+01:00', '@2024-03-01', '@T00:59:59.999'],
    ],
    [
      '1900-03-01T00:00:00.000Z',
      330,
      ['@1900-03-01T05:30:00.000+05:30', '@1900-03-01', '@T05:30:00.000'],
    ],
  ])('takes %s at offset %i', (instant, offset, expected) => {
    expect(snapshotLiterals(utc(instant), offset)).toEqual(expected);
  });

  it('gives now() millisecond precision', () => {
    const snapshot = takeNowSnapshot(utc('2026-11-04T21:05:09.000Z'), 0);
    expect(snapshot.now.precision).toBe('millisecond');
    expect(snapshot.today.precision).toBe('day');
    expect(snapshot.timeOfDay.precision).toBe('millisecond');
  });

  it.each([
    [new Date(Number.NaN), 0, 'eval/invalid-argument', 'an invalid Date'],
    [utc('2026-11-04T21:05:09.007Z'), 841, 'eval/invalid-argument', 'an offset beyond +14:00'],
    [utc('2026-11-04T21:05:09.007Z'), 0.5, 'eval/invalid-argument', 'a fractional offset'],
    [new Date(8.64e15), 0, 'eval/datetime-out-of-range', 'a year beyond 9999'],
  ])('raises an error for %s at offset %d: %s (%s)', (at, offset, code) => {
    expect(() => takeNowSnapshot(at, offset)).toThrow(expect.objectContaining({ code }));
  });
});

describe('resolveTimezoneOffset', () => {
  const at = utc('2026-11-04T21:05:09.007Z');

  it('defaults to UTC (ADR-0012)', () => {
    expect(resolveTimezoneOffset(undefined, at)).toBe(0);
  });

  it.each([0, 60, -300, 330, 840, -840])('passes %i minutes through', (offset) => {
    expect(resolveTimezoneOffset(offset, at)).toBe(offset);
  });

  it("uses the host's offset at the given instant for 'local'", () => {
    const expected = 0 - at.getTimezoneOffset();
    expect(Object.is(resolveTimezoneOffset('local', at), expected)).toBe(true);
  });

  it.each([841, -841, 1.5, Number.NaN])('raises eval/invalid-argument for %d', (offset) => {
    expect(() => resolveTimezoneOffset(offset, at)).toThrow(
      expect.objectContaining({ code: 'eval/invalid-argument' }),
    );
  });
});

describe('host timezone independence', () => {
  // The only way the host's timezone may enter is `resolveTimezoneOffset('local', …)`. Make every
  // local-time method of Date throw, and run the rest of the module.
  const localTimeMethods = [
    'getTimezoneOffset',
    'getFullYear',
    'getMonth',
    'getDate',
    'getDay',
    'getHours',
    'getMinutes',
    'getSeconds',
    'getMilliseconds',
    'setFullYear',
    'setMonth',
    'setDate',
    'setHours',
    'setMinutes',
    'setSeconds',
    'setMilliseconds',
    'toString',
    'toDateString',
    'toTimeString',
    'toLocaleString',
    'toLocaleDateString',
    'toLocaleTimeString',
  ] as const;

  beforeEach(() => {
    for (const method of localTimeMethods) {
      vi.spyOn(Date.prototype, method).mockImplementation(() => {
        throw new Error(`Date.prototype.${method} reads the host's timezone`);
      });
    }
    vi.spyOn(Date, 'parse').mockImplementation(() => {
      throw new Error("Date.parse may read the host's timezone");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses, formats, compares and calculates without reading the local time', () => {
    const at = new Date(1_793_000_000_000);
    const offset = resolveTimezoneOffset(undefined, at);
    const snapshot = takeNowSnapshot(at, offset);
    const values = [
      snapshot.now,
      snapshot.today,
      literal('@2012-04-15'),
      literal('@2012-04-15T10:00'),
      literal('@2012-04-15T10:00:00.000+14:00'),
    ];
    for (const a of values) {
      for (const b of values) {
        compareTemporal(a, b, offset);
        temporalEquals(a, b);
        temporalEquivalent(a, b);
      }
      addCalendar(a, 1, 'month');
      subtractCalendar(a, 1.5, 'days');
      a.toString();
      a.toLiteral();
    }
    addCalendar(snapshot.timeOfDay, 25, 'hours');
    parseDate('2012-04-15');
    parseDateTime('2012-04-15T10:00:00Z');
    parseTime('10:00');
    expect(() => resolveTimezoneOffset('local', at)).toThrow(/getTimezoneOffset/);
  });
});
