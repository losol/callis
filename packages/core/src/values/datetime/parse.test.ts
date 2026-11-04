import { describe, expect, it } from 'vitest';
import { DateValue } from './date.ts';
import { DateTimeValue } from './datetime.ts';
import { parseDate, parseDateTime, parseTemporalLiteral, parseTime } from './parse.ts';
import { TimeValue } from './time.ts';

/** The fields of a parsed value, for compact assertions. */
function fieldsOf(value: object | undefined): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));
}

describe('parseTemporalLiteral', () => {
  // https://hl7.org/fhirpath/N1/#date
  it.each([
    ['@2014-01-25', { year: 2014, month: 1, day: 25, precision: 'day' }],
    ['@2014-01', { year: 2014, month: 1, precision: 'month' }],
    ['@2014', { year: 2014, precision: 'year' }],
  ])('parses the Date literal %s (N1 §4.1.5)', (text, expected) => {
    const value = parseTemporalLiteral(text);
    expect(value).toBeInstanceOf(DateValue);
    expect(fieldsOf(value)).toEqual(expected);
  });

  // https://hl7.org/fhirpath/N1/#time
  it.each([
    ['@T12:00', { hour: 12, minute: 0, precision: 'minute' }],
    [
      '@T14:30:14.559',
      { hour: 14, minute: 30, second: 14, millisecond: 559, precision: 'millisecond' },
    ],
    ['@T14', { hour: 14, precision: 'hour' }], // testLiteralTimeHour
    ['@T14:34:28', { hour: 14, minute: 34, second: 28, precision: 'second' }], // testLiteralTimeSecond
  ])('parses the Time literal %s (N1 §4.1.6)', (text, expected) => {
    const value = parseTemporalLiteral(text);
    expect(value).toBeInstanceOf(TimeValue);
    expect(fieldsOf(value)).toEqual(expected);
  });

  // https://hl7.org/fhirpath/N1/#datetime
  it.each([
    [
      '@2014-01-25T14:30:14.559',
      {
        year: 2014,
        month: 1,
        day: 25,
        hour: 14,
        minute: 30,
        second: 14,
        millisecond: 559,
        precision: 'millisecond',
      },
    ],
    [
      '@2014-01-25T14:30:14.559Z',
      {
        year: 2014,
        month: 1,
        day: 25,
        hour: 14,
        minute: 30,
        second: 14,
        millisecond: 559,
        offsetMinutes: 0,
        precision: 'millisecond',
      },
    ],
    [
      '@2014-01-25T14:30',
      { year: 2014, month: 1, day: 25, hour: 14, minute: 30, precision: 'minute' },
    ],
    ['@2014-03-25T', { year: 2014, month: 3, day: 25, precision: 'day' }],
    ['@2014-01T', { year: 2014, month: 1, precision: 'month' }],
    ['@2014T', { year: 2014, precision: 'year' }],
    // testLiteralDateTimeHour, testPlusDate24
    ['@2015-02-04T14', { year: 2015, month: 2, day: 4, hour: 14, precision: 'hour' }],
    [
      '@2015-02-04T10Z',
      { year: 2015, month: 2, day: 4, hour: 10, offsetMinutes: 0, precision: 'hour' },
    ],
    // testLiteralDateTimeTimezoneOffset
    [
      '@2015-02-04T14:34:28+10:00',
      {
        year: 2015,
        month: 2,
        day: 4,
        hour: 14,
        minute: 34,
        second: 28,
        offsetMinutes: 600,
        precision: 'second',
      },
    ],
    // https://hl7.org/fhirpath/N1/#datetime-equality
    [
      '@2017-11-05T01:30:00.0-04:00',
      {
        year: 2017,
        month: 11,
        day: 5,
        hour: 1,
        minute: 30,
        second: 0,
        millisecond: 0,
        offsetMinutes: -240,
        precision: 'millisecond',
      },
    ],
  ])('parses the DateTime literal %s (N1 §4.1.7)', (text, expected) => {
    const value = parseTemporalLiteral(text);
    expect(value).toBeInstanceOf(DateTimeValue);
    expect(fieldsOf(value)).toEqual(expected);
  });

  it.each([
    ['@2015-02-04T14:34:28+14:00', 840],
    ['@2015-02-04T14:34:28-14:00', -840],
    ['@2015-02-04T14:34:28+05:30', 330],
    ['@2015-02-04T14:34:28-09:30', -570],
    ['@2015-02-04T14:34:28+00:00', 0],
    ['@2015-02-04T14:34:28-00:00', 0],
  ])('reads the offset of %s', (text, offsetMinutes) => {
    const value = parseTemporalLiteral(text);
    expect(value).toBeInstanceOf(DateTimeValue);
    expect(value instanceof DateTimeValue && Object.is(value.offsetMinutes, offsetMinutes)).toBe(
      true,
    );
  });

  it('truncates fractional seconds beyond milliseconds (N1 §4.1.7 minimum precision)', () => {
    expect(fieldsOf(parseTemporalLiteral('@T10:00:00.1239'))).toMatchObject({ millisecond: 123 });
    expect(fieldsOf(parseTemporalLiteral('@T10:00:00.5'))).toMatchObject({ millisecond: 500 });
    expect(fieldsOf(parseTemporalLiteral('@T10:00:00.05'))).toMatchObject({ millisecond: 50 });
  });

  it.each([
    // Well-formed literals with invalid values: the compiler turns these into eval/invalid-literal.
    ['@2015-13', 'month 13'],
    ['@2015-00', 'month 0'],
    ['@2015-02-29', 'February 29 in a common year'],
    ['@2015-02-30', 'February 30'],
    ['@2015-04-31', 'April 31'],
    ['@1900-02-29', 'February 29 in a century that is not a leap year'],
    ['@0000-01-01', 'year 0'],
    ['@2015-02-04T24:00', 'hour 24'],
    ['@2015-02-04T23:60', 'minute 60'],
    ['@2015-02-04T23:59:60', 'a leap second'],
    ['@2015-02-04T10:00+14:01', 'an offset beyond +14:00'],
    ['@2015-02-04T10:00-15:00', 'an offset beyond -14:00'],
    ['@2015-02-04T10:00+10:60', 'offset minutes beyond 59'],
    ['@T24', 'hour 24 in a Time'],
    ['@T14:34:28Z', 'a timezone on a Time (testLiteralTimeUTC)'],
    ['@T14:34:28+10:00', 'a timezone on a Time (testLiteralTimeTimezoneOffset)'],
    ['@2015T10:00', 'a time on a year-only date'],
    ['@2015-02T10', 'a time on a year-month date'],
    // Malformed text: the lexer rejects these first, but the parser must not accept them either.
    ['2015-02-04', 'a missing @'],
    ['@2015-2-4', 'unpadded components'],
    ['@15-02-04', 'a two-digit year'],
    ['@2015-02-04T10:00+1000', 'an offset without a colon'],
    ['@2015-02-04T10:00+10', 'an offset without minutes'],
    ['@2015-02-04 T10:00', 'a space'],
    ['@2015-02-04T10:00:00.', 'a dot without digits'],
    ['@2015Z', 'a timezone without a time'],
    ['@T', 'an empty time'],
    ['@', 'nothing'],
  ])('rejects %s (%s)', (text) => {
    expect(parseTemporalLiteral(text)).toBeUndefined();
  });

  it('accepts the leap day in leap years, including centuries divisible by 400', () => {
    expect(parseTemporalLiteral('@2016-02-29')).toBeInstanceOf(DateValue);
    expect(parseTemporalLiteral('@2000-02-29')).toBeInstanceOf(DateValue);
  });

  it('accepts the range limits', () => {
    expect(parseTemporalLiteral('@0001-01-01')).toBeInstanceOf(DateValue);
    expect(parseTemporalLiteral('@9999-12-31T23:59:59.999')).toBeInstanceOf(DateTimeValue);
    expect(parseTemporalLiteral('@T00:00:00.000')).toBeInstanceOf(TimeValue);
    expect(parseTemporalLiteral('@T23:59:59.999')).toBeInstanceOf(TimeValue);
  });
});

describe('parseDate', () => {
  // https://hl7.org/fhirpath/N1/#todate-date and the FHIR `date` format
  it.each([
    ['2014-01-25', '2014-01-25'],
    ['2014-01', '2014-01'],
    ['2014', '2014'],
  ])('parses %s', (text, expected) => {
    expect(parseDate(text)?.toString()).toBe(expected);
  });

  it.each([
    '@2014-01-25',
    '2014-01-25T',
    '2014-01-25T10:00',
    '2014-02-30',
    ' 2014-01-25',
    '2014-01-25 ',
    '',
  ])('rejects %j', (text) => {
    expect(parseDate(text)).toBeUndefined();
  });
});

describe('parseDateTime', () => {
  // https://hl7.org/fhirpath/N1/#todatetime-datetime, testLiteral*ToDateTime and FHIR `dateTime`
  it.each([
    ['2015', '2015'], // testLiteralYearToDateTime
    ['2015-02', '2015-02'], // testLiteralMonthToDateTime
    ['2015-02-04', '2015-02-04'], // testLiteralDayToDateTime
    ['2015-02-04T14:34:28', '2015-02-04T14:34:28'], // testLiteralSecondToDateTime
    ['2015-02-04T14:34:28.123', '2015-02-04T14:34:28.123'], // testLiteralMillisecondToDateTime
    ['2015-02-04T14:34:28Z', '2015-02-04T14:34:28Z'], // testLiteralUTCToDateTime
    ['2015-02-04T14:34:28+10:00', '2015-02-04T14:34:28+10:00'], // testLiteralTZToDateTime
    ['2012-01-01T10:00', '2012-01-01T10:00'], // 3.0.0 toDateTime(): partial datetime is preserved
    ['2015-02-04T14', '2015-02-04T14'],
  ])('parses %s', (text, expected) => {
    const value = parseDateTime(text);
    expect(value).toBeInstanceOf(DateTimeValue);
    expect(value?.toString()).toBe(expected);
  });

  it('parses a FHIR instant and truncates its fraction to milliseconds', () => {
    // https://hl7.org/fhir/R4/datatypes.html#instant
    expect(parseDateTime('2015-02-07T13:28:17.239+02:00')?.toString()).toBe(
      '2015-02-07T13:28:17.239+02:00',
    );
    expect(parseDateTime('2015-02-07T13:28:17.123456789Z')?.toString()).toBe(
      '2015-02-07T13:28:17.123Z',
    );
  });

  it.each([
    '@2015-02-04',
    '2015T',
    '2015-02-04T',
    '2015T10:00',
    '2015-02-04T10:00:00+14:30',
    '2015-02-04 10:00:00',
    '2015-02-04T25:00:00',
  ])('rejects %j', (text) => {
    expect(parseDateTime(text)).toBeUndefined();
  });
});

describe('parseTime', () => {
  // https://hl7.org/fhirpath/N1/#totime-time and the FHIR `time` format
  it.each([
    ['14:34:28', '14:34:28'],
    ['10:00', '10:00'],
    ['10', '10'],
    ['14:34:28.123', '14:34:28.123'],
    ['14:34:28.1', '14:34:28.100'],
  ])('parses %s', (text, expected) => {
    expect(parseTime(text)?.toString()).toBe(expected);
  });

  it.each(['T14:34:28', '@T14:34:28', '14:34:28Z', '14:34:28+01:00', '24:00:00', '1:00', ''])(
    'rejects %j',
    (text) => {
      expect(parseTime(text)).toBeUndefined();
    },
  );
});
