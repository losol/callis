/**
 * Proleptic Gregorian calendar arithmetic and component validation, shared by the date/time value
 * types. Everything here is pure and independent of the host's timezone.
 */
import type { DatePrecision, TimePrecision } from './precision.ts';

/** Smallest year a Date or DateTime can have ([N1 §4.1.5](https://hl7.org/fhirpath/N1/#date)). */
export const MIN_YEAR = 1;
/** Largest year a Date or DateTime can have. */
export const MAX_YEAR = 9999;
/** Largest timezone offset in minutes: ±14:00, the widest offset in use. */
export const MAX_OFFSET_MINUTES: number = 14 * 60;

/** Milliseconds in a second. */
export const MS_PER_SECOND = 1000;
/** Milliseconds in a minute. */
export const MS_PER_MINUTE: number = 60 * MS_PER_SECOND;
/** Milliseconds in an hour. */
export const MS_PER_HOUR: number = 60 * MS_PER_MINUTE;
/** Milliseconds in a day, without leap seconds. */
export const MS_PER_DAY: number = 24 * MS_PER_HOUR;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** A year-month-day triple. */
export interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Whether `year` is a Gregorian leap year. */
export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** The number of days in `month` (1–12) of `year`. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }
  return DAYS_IN_MONTH[month - 1] ?? 0;
}

/**
 * Days from 1970-01-01 to the given date (negative before it).
 *
 * Howard Hinnant's `days_from_civil`, which is exact for every proleptic Gregorian date.
 */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The date `days` days after 1970-01-01. The inverse of {@link daysFromCivil}. */
export function civilFromDays(days: number): CivilDate {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

/**
 * Milliseconds from 1970-01-01T00:00 to the given wall-clock time, ignoring any timezone offset.
 * Missing components count as their smallest value.
 */
export function wallClockMilliseconds(
  year: number,
  month = 1,
  day = 1,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): number {
  return (
    daysFromCivil(year, month, day) * MS_PER_DAY +
    hour * MS_PER_HOUR +
    minute * MS_PER_MINUTE +
    second * MS_PER_SECOND +
    millisecond
  );
}

/** Whether `value` is an integer in `[min, max]`. */
export function isIntegerInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** Whether `offsetMinutes` is a whole number of minutes within ±14:00. */
export function isValidOffset(offsetMinutes: number): boolean {
  return isIntegerInRange(offsetMinutes, -MAX_OFFSET_MINUTES, MAX_OFFSET_MINUTES);
}

/**
 * The precision of a valid date, or undefined if a component is out of range or a component is
 * present while a coarser one is missing (a day without a month).
 */
export function datePrecisionOf(
  year: number,
  month: number | undefined,
  day: number | undefined,
): DatePrecision | undefined {
  if (!isIntegerInRange(year, MIN_YEAR, MAX_YEAR)) {
    return undefined;
  }
  if (month === undefined) {
    return day === undefined ? 'year' : undefined;
  }
  if (!isIntegerInRange(month, 1, 12)) {
    return undefined;
  }
  if (day === undefined) {
    return 'month';
  }
  return isIntegerInRange(day, 1, daysInMonth(year, month)) ? 'day' : undefined;
}

/**
 * The precision of a valid time of day, or undefined if a component is out of range or a component
 * is present while a coarser one is missing. Leap seconds (`:60`) are not supported.
 */
export function timePrecisionOf(
  hour: number,
  minute: number | undefined,
  second: number | undefined,
  millisecond: number | undefined,
): TimePrecision | undefined {
  if (!isIntegerInRange(hour, 0, 23)) {
    return undefined;
  }
  if (minute === undefined) {
    return second === undefined && millisecond === undefined ? 'hour' : undefined;
  }
  if (!isIntegerInRange(minute, 0, 59)) {
    return undefined;
  }
  if (second === undefined) {
    return millisecond === undefined ? 'minute' : undefined;
  }
  if (!isIntegerInRange(second, 0, 59)) {
    return undefined;
  }
  if (millisecond === undefined) {
    return 'second';
  }
  return isIntegerInRange(millisecond, 0, 999) ? 'millisecond' : undefined;
}
