/**
 * Ordering, equality and equivalence of Date, DateTime and Time values.
 *
 * @see https://hl7.org/fhirpath/N1/#datetime-equality
 * @see https://hl7.org/fhirpath/N1/#comparison
 */
import { FhirPathEvaluationError } from '../../errors/fhirpath-error.ts';
import {
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  wallClockMilliseconds,
} from './calendar.ts';
import type { DateValue } from './date.ts';
import { DateTimeValue } from './datetime.ts';
import type { TemporalValue } from './temporal-value.ts';
import { TimeValue } from './time.ts';

/**
 * The result of comparing two date/time values: -1 if the first is earlier, 0 if they are the
 * same, 1 if the first is later, or undefined when the order is unknown because the values have
 * different precisions.
 */
export type TemporalComparison = -1 | 0 | 1 | undefined;

/**
 * Compares two date/time values, as the operators `<`, `<=`, `>` and `>=` need.
 *
 * Date and DateTime values can be compared with each other (a Date converts to a DateTime). Each
 * value stands for the span of time its precision covers: `@2018-03` is all of March. The result
 * is -1 or 1 when one span ends before the other starts, 0 when the spans are the same, and
 * undefined when they overlap without being the same, for example because the precisions differ
 * (`@2018-03` and `@2018-03-01`). For values that line up with their own precision, this is the
 * same as the spec's rule of comparing component by component, from the year down. Seconds and
 * milliseconds count as one precision, so `@T10:30:00` and `@T10:30:00.0` are the same.
 *
 * Timezone offsets are respected. A value without an offset (and every Date) is taken to be at
 * `defaultOffsetMinutes`, which is 0 (UTC) unless the evaluation sets `timezoneOffset`
 * ([ADR-0012](https://github.com/losol/callis/blob/main/docs/adr/0012-evaluation-defaults.md)).
 *
 * @param defaultOffsetMinutes Offset, in minutes east of UTC, for values without one.
 * @throws FhirPathEvaluationError `eval/type-mismatch` if a Time is compared with a Date or
 * DateTime.
 * @see https://hl7.org/fhirpath/N1/#comparison
 */
export function compareTemporal(
  a: TemporalValue,
  b: TemporalValue,
  defaultOffsetMinutes = 0,
): TemporalComparison {
  if (a instanceof TimeValue || b instanceof TimeValue) {
    if (!(a instanceof TimeValue && b instanceof TimeValue)) {
      throw new FhirPathEvaluationError(
        'eval/type-mismatch',
        'Cannot compare a Time with a Date or DateTime',
      );
    }
    const startA = timeStart(a);
    const startB = timeStart(b);
    return compareSpans(
      startA,
      startA + spanLength(a.precision),
      startB,
      startB + spanLength(b.precision),
    );
  }
  const startA = dateTimeStart(a, defaultOffsetMinutes);
  const startB = dateTimeStart(b, defaultOffsetMinutes);
  return compareSpans(
    startA,
    dateTimeEnd(a, startA, defaultOffsetMinutes),
    startB,
    dateTimeEnd(b, startB, defaultOffsetMinutes),
  );
}

/**
 * Date/time equality (`=`): true if the values are the same to the same precision, false if they
 * differ, and undefined (empty) if the precisions differ and the values agree as far as both go.
 * A Time is never equal to a Date or DateTime.
 *
 * @param defaultOffsetMinutes Offset, in minutes east of UTC, for values without one.
 * @see https://hl7.org/fhirpath/N1/#datetime-equality
 */
export function temporalEquals(
  a: TemporalValue,
  b: TemporalValue,
  defaultOffsetMinutes = 0,
): boolean | undefined {
  if (a instanceof TimeValue !== b instanceof TimeValue) {
    return false;
  }
  const order = compareTemporal(a, b, defaultOffsetMinutes);
  return order === undefined ? undefined : order === 0;
}

/**
 * Date/time equivalence (`~`): like {@link temporalEquals}, except that values with different
 * precisions are not equivalent (false instead of empty).
 *
 * @param defaultOffsetMinutes Offset, in minutes east of UTC, for values without one.
 * @see https://hl7.org/fhirpath/N1/#datetime-equivalence
 */
export function temporalEquivalent(
  a: TemporalValue,
  b: TemporalValue,
  defaultOffsetMinutes = 0,
): boolean {
  if (a instanceof TimeValue !== b instanceof TimeValue) {
    return false;
  }
  return compareTemporal(a, b, defaultOffsetMinutes) === 0;
}

/** Compares the half-open spans `[startA, endA)` and `[startB, endB)`. */
function compareSpans(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): TemporalComparison {
  if (endA <= startB) {
    return -1;
  }
  if (endB <= startA) {
    return 1;
  }
  return startA === startB && endA === endB ? 0 : undefined;
}

/** The length of the span a time of day covers. Seconds are a point, like milliseconds. */
function spanLength(precision: TimeValue['precision']): number {
  switch (precision) {
    case 'hour':
      return MS_PER_HOUR;
    case 'minute':
      return MS_PER_MINUTE;
    case 'second':
    case 'millisecond':
      return 1;
  }
}

function timeStart(value: TimeValue): number {
  return (
    value.hour * MS_PER_HOUR +
    (value.minute ?? 0) * MS_PER_MINUTE +
    (value.second ?? 0) * MS_PER_SECOND +
    (value.millisecond ?? 0)
  );
}

function offsetOf(value: DateValue | DateTimeValue, defaultOffsetMinutes: number): number {
  return value instanceof DateTimeValue
    ? (value.offsetMinutes ?? defaultOffsetMinutes)
    : defaultOffsetMinutes;
}

/** Start of the span a date or date/time covers, in UTC milliseconds since 1970-01-01. */
function dateTimeStart(value: DateValue | DateTimeValue, defaultOffsetMinutes: number): number {
  const local =
    value instanceof DateTimeValue
      ? wallClockMilliseconds(
          value.year,
          value.month,
          value.day,
          value.hour,
          value.minute,
          value.second,
          value.millisecond,
        )
      : wallClockMilliseconds(value.year, value.month, value.day);
  return local - offsetOf(value, defaultOffsetMinutes) * MS_PER_MINUTE;
}

/** End (exclusive) of the span a date or date/time covers, given its start. */
function dateTimeEnd(
  value: DateValue | DateTimeValue,
  start: number,
  defaultOffsetMinutes: number,
): number {
  switch (value.precision) {
    case 'year':
      return (
        wallClockMilliseconds(value.year + 1) -
        offsetOf(value, defaultOffsetMinutes) * MS_PER_MINUTE
      );
    case 'month': {
      const month = value.month ?? 1;
      const next =
        month === 12
          ? wallClockMilliseconds(value.year + 1, 1)
          : wallClockMilliseconds(value.year, month + 1);
      return next - offsetOf(value, defaultOffsetMinutes) * MS_PER_MINUTE;
    }
    case 'day':
      return start + MS_PER_DAY;
    default:
      return start + spanLength(value.precision);
  }
}
