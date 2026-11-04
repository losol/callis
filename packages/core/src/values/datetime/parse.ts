/**
 * Parsing of FHIRPath date/time literals and of date/time strings (FHIR JSON primitives and the
 * string input of `toDate()`, `toDateTime()` and `toTime()`).
 *
 * Every parser returns undefined for text that is malformed or names an invalid date or time, so
 * callers decide what that means: an `eval/invalid-literal` error for a literal (T0008), empty for a
 * conversion function (T0014).
 */
import { MAX_OFFSET_MINUTES } from './calendar.ts';
import { DateValue } from './date.ts';
import { DateTimeValue } from './datetime.ts';
import type { TemporalValue } from './temporal-value.ts';
import { TimeValue } from './time.ts';

// Each pattern is anchored and has no nested quantifiers, so matching is linear in the input.
const TIME = String.raw`(\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?`;
const OFFSET = String.raw`(Z|[+-]\d{2}:\d{2})`;
const DATE = String.raw`(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?`;

const DATE_PATTERN = new RegExp(`^${DATE}$`);
const TIME_PATTERN = new RegExp(`^${TIME}$`);
const DATE_TIME_PATTERN = new RegExp(`^${DATE}(?:T${TIME}${OFFSET}?)?$`);
// The grammar's DATE and DATETIME tokens: '@' DATEFORMAT ('T' (TIMEFORMAT TIMEZONEOFFSETFORMAT?)?)?
const DATE_LITERAL_PATTERN = new RegExp(`^@${DATE}(?:(T)(?:${TIME}${OFFSET}?)?)?$`);
// The grammar's TIME token, plus an offset so that `@T14:34:28Z` parses and is then rejected.
const TIME_LITERAL_PATTERN = new RegExp(`^@T${TIME}${OFFSET}?$`);

/**
 * Parses a date: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. This is the FHIR `date` format and the string
 * format accepted by `toDate()`.
 *
 * @see https://hl7.org/fhirpath/N1/#todate-date
 * @see https://hl7.org/fhir/R4/datatypes.html#date
 */
export function parseDate(text: string): DateValue | undefined {
  const match = DATE_PATTERN.exec(text);
  if (match === null) {
    return undefined;
  }
  return DateValue.tryCreate({
    year: Number(match[1]),
    month: optionalNumber(match[2]),
    day: optionalNumber(match[3]),
  });
}

/**
 * Parses a date/time: a date as in {@link parseDate}, optionally followed by `T`, a time as in
 * {@link parseTime} and a timezone offset (`Z` or `±hh:mm`). A time needs a full date.
 *
 * This covers the FHIR `dateTime` and `instant` formats and the string format accepted by
 * `toDateTime()`. Partial times (`2015-02-04T14:30`) are accepted at their own precision, as for
 * literals. Fractional seconds beyond milliseconds are truncated.
 *
 * @see https://hl7.org/fhirpath/N1/#todatetime-datetime
 * @see https://hl7.org/fhir/R4/datatypes.html#dateTime
 */
export function parseDateTime(text: string): DateTimeValue | undefined {
  const match = DATE_TIME_PATTERN.exec(text);
  if (match === null) {
    return undefined;
  }
  return createDateTime(match, 4);
}

/**
 * Parses a time of day: `hh`, `hh:mm`, `hh:mm:ss` or `hh:mm:ss.fff` with any number of fractional
 * digits (truncated to milliseconds). A timezone offset is not allowed, because Time values have
 * none ([N1 §4.1.6](https://hl7.org/fhirpath/N1/#time)).
 *
 * This covers the FHIR `time` format and the string format accepted by `toTime()`.
 *
 * @see https://hl7.org/fhirpath/N1/#totime-time
 */
export function parseTime(text: string): TimeValue | undefined {
  const match = TIME_PATTERN.exec(text);
  if (match === null) {
    return undefined;
  }
  return createTime(match, 1);
}

/**
 * Parses a FHIRPath date/time literal, including the leading `@`:
 *
 * - Date: `@2014-01-25`, `@2014-01`, `@2014`
 * - DateTime: `@2014-01-25T14:30:14.559+01:00`, `@2014-01-25T14:30`, `@2014-01T`, `@2014T`
 * - Time: `@T14:30:14.559`, `@T14`
 *
 * Returns undefined for malformed text and for well-formed literals with an invalid value: an
 * out-of-range component (`@2015-02-30`), a time on a partial date (`@2015T10:00`, which the
 * grammar allows but which is not a date and time), or a timezone on a Time (`@T14:34:28Z`).
 *
 * @see https://hl7.org/fhirpath/N1/#date
 * @see https://hl7.org/fhirpath/N1/grammar.html
 */
export function parseTemporalLiteral(text: string): TemporalValue | undefined {
  const date = DATE_LITERAL_PATTERN.exec(text);
  if (date !== null) {
    if (date[4] === undefined) {
      return DateValue.tryCreate({
        year: Number(date[1]),
        month: optionalNumber(date[2]),
        day: optionalNumber(date[3]),
      });
    }
    return createDateTime(date, 5);
  }
  const time = TIME_LITERAL_PATTERN.exec(text);
  if (time === null || time[5] !== undefined) {
    return undefined;
  }
  return createTime(time, 1);
}

/**
 * Builds a date/time from a match whose groups 1–3 are the date, followed by the time groups
 * (hour, minute, second, fraction) and the offset group starting at `timeGroup`.
 */
function createDateTime(match: RegExpExecArray, timeGroup: number): DateTimeValue | undefined {
  const offsetText = match[timeGroup + 4];
  const offsetMinutes = offsetText === undefined ? undefined : parseOffset(offsetText);
  if (offsetMinutes === null) {
    return undefined;
  }
  return DateTimeValue.tryCreate({
    year: Number(match[1]),
    month: optionalNumber(match[2]),
    day: optionalNumber(match[3]),
    hour: optionalNumber(match[timeGroup]),
    minute: optionalNumber(match[timeGroup + 1]),
    second: optionalNumber(match[timeGroup + 2]),
    millisecond: fractionToMilliseconds(match[timeGroup + 3]),
    offsetMinutes,
  });
}

/** Builds a time from a match whose groups start at `hourGroup` (hour, minute, second, fraction). */
function createTime(match: RegExpExecArray, hourGroup: number): TimeValue | undefined {
  return TimeValue.tryCreate({
    hour: Number(match[hourGroup]),
    minute: optionalNumber(match[hourGroup + 1]),
    second: optionalNumber(match[hourGroup + 2]),
    millisecond: fractionToMilliseconds(match[hourGroup + 3]),
  });
}

function optionalNumber(digits: string | undefined): number | undefined {
  return digits === undefined ? undefined : Number(digits);
}

/** The first three fractional digits as milliseconds: `5` → 500, `123456` → 123. */
function fractionToMilliseconds(fraction: string | undefined): number | undefined {
  return fraction === undefined ? undefined : Number(fraction.slice(0, 3).padEnd(3, '0'));
}

/** `Z` or `±hh:mm` in minutes, or null if the minutes or the whole offset are out of range. */
function parseOffset(text: string): number | null {
  if (text === 'Z') {
    return 0;
  }
  const hours = Number(text.slice(1, 3));
  const minutes = Number(text.slice(4, 6));
  const total = hours * 60 + minutes;
  if (minutes > 59 || total > MAX_OFFSET_MINUTES) {
    return null;
  }
  // `-00:00` is the same offset as `+00:00`; avoid a negative zero.
  return text.startsWith('-') && total !== 0 ? -total : total;
}
