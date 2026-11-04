/**
 * Date/time arithmetic: adding and subtracting time-valued quantities with calendar semantics.
 *
 * The functions take the quantity as an amount and a unit, so this module does not depend on the
 * Quantity class (T0006). A `Decimal` (T0004) is a {@link DecimalAmount}.
 *
 * @see https://hl7.org/fhirpath/N1/#datetime-arithmetic
 * @see https://hl7.org/fhirpath/STU3/ (Date/Time Arithmetic, which refines the rules for UCUM units
 * and partial values)
 */
import { FhirPathEvaluationError } from '../../errors/fhirpath-error.ts';
import {
  civilFromDays,
  daysInMonth,
  MAX_YEAR,
  MIN_YEAR,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  wallClockMilliseconds,
} from './calendar.ts';
import { DateValue } from './date.ts';
import type { DateTimeFields } from './datetime.ts';
import { DateTimeValue } from './datetime.ts';
import type { TemporalValue } from './temporal-value.ts';
import { TimeValue } from './time.ts';

/** A calendar duration unit, in its singular form. */
export type CalendarUnit =
  | 'year'
  | 'month'
  | 'week'
  | 'day'
  | 'hour'
  | 'minute'
  | 'second'
  | 'millisecond';

/**
 * An exact decimal amount, `coefficient × 10^-scale`. The `Decimal` class has this shape, so a
 * quantity's value can be passed as it is.
 */
export interface DecimalAmount {
  readonly coefficient: bigint;
  readonly scale: number;
}

/** The amount of a time-valued quantity: a JavaScript number or an exact decimal. */
export type CalendarAmount = number | DecimalAmount;

type FixedUnit = 'day' | 'hour' | 'minute' | 'second' | 'millisecond';

const MILLISECONDS: Readonly<Record<FixedUnit, bigint>> = {
  day: BigInt(MS_PER_DAY),
  hour: BigInt(MS_PER_HOUR),
  minute: BigInt(MS_PER_MINUTE),
  second: BigInt(MS_PER_SECOND),
  millisecond: 1n,
};

// A partial value converts the quantity to its own precision: a month counts as 30 days and a year
// as 365 days (3.0.0, Date/Time Arithmetic).
const MONTH_IN_MILLISECONDS = 30n * MILLISECONDS.day;
const YEAR_IN_MILLISECONDS = 365n * MILLISECONDS.day;

// Any shift beyond these bounds leaves the range 0001–9999, so smaller ones convert to `number`
// exactly.
const MAX_YEARS = BigInt(MAX_YEAR);
const MAX_MONTHS = 12n * MAX_YEARS;
const MAX_MILLISECONDS = 366n * MAX_YEARS * MILLISECONDS.day;

/**
 * Adds a time-valued quantity to a Date, DateTime or Time (the `+` operator).
 *
 * - `unit` is a calendar keyword, singular or plural (`month`, `days`), or one of the UCUM units
 *   `'wk'`, `'d'`, `'h'`, `'min'`, `'s'` and `'ms'`, which act as `week` … `millisecond`.
 * - Years and months use calendar semantics: a day that does not exist in the resulting month is
 *   clamped to the month's last day (`@2020-01-31 + 1 month` is `@2020-02-29`).
 * - The fraction of the amount is dropped for units above seconds (`7.9 days` adds 7 days).
 *   Seconds keep their fraction down to milliseconds (`0.1 's'` adds 100 ms).
 * - A partial value first converts the quantity to its own precision and drops the remainder,
 *   with 12 months, 30 days or 365 days to the next step: `@2014 + 23 months` is `@2015`.
 * - Time wraps around midnight: `@T23:30 + 1 hour` is `@T00:30`.
 *
 * @throws FhirPathEvaluationError `eval/invalid-calendar-unit` if the unit is not a time unit, is
 * `'a'` or `'mo'` (whose length varies), or does not apply to the value: a Date takes years to
 * days, a Time takes hours to milliseconds.
 * @throws FhirPathEvaluationError `eval/datetime-out-of-range` if a Date or DateTime result falls
 * outside 0001–9999.
 * @throws FhirPathEvaluationError `eval/invalid-argument` if the amount is `NaN` or infinite, or a
 * decimal amount's scale is not an integer.
 * @see https://hl7.org/fhirpath/N1/#addition-2
 */
export function addCalendar(value: DateValue, amount: CalendarAmount, unit: string): DateValue;
export function addCalendar(
  value: DateTimeValue,
  amount: CalendarAmount,
  unit: string,
): DateTimeValue;
export function addCalendar(value: TimeValue, amount: CalendarAmount, unit: string): TimeValue;
export function addCalendar(
  value: TemporalValue,
  amount: CalendarAmount,
  unit: string,
): TemporalValue;
export function addCalendar(
  value: TemporalValue,
  amount: CalendarAmount,
  unit: string,
): TemporalValue {
  return addSigned(value, amount, unit, false);
}

/**
 * Subtracts a time-valued quantity from a Date, DateTime or Time (the `-` operator). This is
 * {@link addCalendar} with the amount negated, so the same units, rules and errors apply.
 *
 * @see https://hl7.org/fhirpath/N1/#subtraction-2
 */
export function subtractCalendar(value: DateValue, amount: CalendarAmount, unit: string): DateValue;
export function subtractCalendar(
  value: DateTimeValue,
  amount: CalendarAmount,
  unit: string,
): DateTimeValue;
export function subtractCalendar(value: TimeValue, amount: CalendarAmount, unit: string): TimeValue;
export function subtractCalendar(
  value: TemporalValue,
  amount: CalendarAmount,
  unit: string,
): TemporalValue;
export function subtractCalendar(
  value: TemporalValue,
  amount: CalendarAmount,
  unit: string,
): TemporalValue {
  return addSigned(value, amount, unit, true);
}

/** Adds the amount, or subtracts it when `negate` is set. The unit is checked first. */
function addSigned(
  value: TemporalValue,
  amount: CalendarAmount,
  unit: string,
  negate: boolean,
): TemporalValue {
  const calendarUnit = toCalendarUnit(unit);
  const exact = toDecimalAmount(amount);
  const signed = negate ? { coefficient: -exact.coefficient, scale: exact.scale } : exact;
  if (value instanceof TimeValue) {
    return addToTime(value, signed, calendarUnit);
  }
  if (value instanceof DateValue) {
    if (!isDateUnit(calendarUnit)) {
      throw new FhirPathEvaluationError(
        'eval/invalid-calendar-unit',
        'A Date can only be changed by years, months, weeks or days',
      );
    }
    return addToDateTime(DateTimeValue.fromDate(value), signed, calendarUnit).toDateValue();
  }
  return addToDateTime(value, signed, calendarUnit);
}

/**
 * The calendar unit a quantity unit stands for in date/time arithmetic.
 *
 * The calendar keywords are accepted in both forms, and quoted (`1 'month'`, test `testMinus5`).
 * The fixed-length UCUM units `'wk'` … `'ms'` are equal to their calendar counterparts, while the
 * UCUM year `'a'` and month `'mo'` are not and raise an error (3.0.0; tests `testPlusDate13`–`22`).
 */
function toCalendarUnit(unit: string): CalendarUnit {
  switch (unit) {
    case 'year':
    case 'years':
      return 'year';
    case 'month':
    case 'months':
      return 'month';
    case 'week':
    case 'weeks':
    case 'wk':
      return 'week';
    case 'day':
    case 'days':
    case 'd':
      return 'day';
    case 'hour':
    case 'hours':
    case 'h':
      return 'hour';
    case 'minute':
    case 'minutes':
    case 'min':
      return 'minute';
    case 'second':
    case 'seconds':
    case 's':
      return 'second';
    case 'millisecond':
    case 'milliseconds':
    case 'ms':
      return 'millisecond';
    case 'a':
    case 'mo':
      throw new FhirPathEvaluationError(
        'eval/invalid-calendar-unit',
        "Date/time arithmetic does not accept the UCUM units 'a' and 'mo', whose length varies; use the calendar durations year and month",
      );
    default:
      throw new FhirPathEvaluationError(
        'eval/invalid-calendar-unit',
        "Date/time arithmetic needs a time unit: year, month, week, day, hour, minute, second or millisecond, or one of the UCUM units 'wk', 'd', 'h', 'min', 's' and 'ms'",
      );
  }
}

function isDateUnit(unit: CalendarUnit): boolean {
  return unit === 'year' || unit === 'month' || unit === 'week' || unit === 'day';
}

function addToDateTime(
  value: DateTimeValue,
  amount: DecimalAmount,
  unit: CalendarUnit,
): DateTimeValue {
  const fields = shiftDateTime(value, amount, unit);
  if (fields.year < MIN_YEAR || fields.year > MAX_YEAR) {
    throw outOfRange();
  }
  return DateTimeValue.create(fields);
}

function shiftDateTime(
  value: DateTimeValue,
  amount: DecimalAmount,
  unit: CalendarUnit,
): DateTimeFields {
  const precision = value.precision;
  if (unit === 'year' || unit === 'month') {
    // Drop the fraction in the quantity's own unit first: 1.5 years is 1 year, not 18 months.
    const months = truncatedMultiple(amount, 1n) * (unit === 'year' ? 12n : 1n);
    // A year-only value takes months directly as years (3.0.0).
    return precision === 'year' ? addYears(value, months / 12n) : addMonths(value, months);
  }
  const milliseconds = fixedMilliseconds(amount, unit);
  if (precision === 'year') {
    return addYears(value, milliseconds / YEAR_IN_MILLISECONDS);
  }
  if (precision === 'month') {
    return addMonths(value, milliseconds / MONTH_IN_MILLISECONDS);
  }
  // Drop what is finer than the value's precision; truncation is toward zero.
  const step = MILLISECONDS[precision];
  return addMilliseconds(value, (milliseconds / step) * step);
}

/** The amount in milliseconds. Above seconds, the fraction is dropped first. */
function fixedMilliseconds(amount: DecimalAmount, unit: FixedUnit | 'week'): bigint {
  switch (unit) {
    case 'week':
      return truncatedMultiple(amount, 1n) * 7n * MILLISECONDS.day;
    case 'second':
      return truncatedMultiple(amount, MILLISECONDS.second);
    default:
      return truncatedMultiple(amount, 1n) * MILLISECONDS[unit];
  }
}

function addYears(value: DateTimeValue, years: bigint): DateTimeFields {
  if (years > MAX_YEARS || years < -MAX_YEARS) {
    throw outOfRange();
  }
  const year = value.year + Number(years);
  return { ...fieldsOf(value), year, day: clampDay(year, value.month, value.day) };
}

function addMonths(value: DateTimeValue, months: bigint): DateTimeFields {
  if (months > MAX_MONTHS || months < -MAX_MONTHS) {
    throw outOfRange();
  }
  const monthIndex = value.year * 12 + (value.month ?? 1) - 1 + Number(months);
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex - year * 12 + 1;
  return { ...fieldsOf(value), year, month, day: clampDay(year, month, value.day) };
}

function addMilliseconds(value: DateTimeValue, milliseconds: bigint): DateTimeFields {
  if (milliseconds > MAX_MILLISECONDS || milliseconds < -MAX_MILLISECONDS) {
    throw outOfRange();
  }
  // Offsets are fixed, so wall-clock arithmetic is exact: there are no daylight-saving gaps.
  const local =
    wallClockMilliseconds(
      value.year,
      value.month,
      value.day,
      value.hour,
      value.minute,
      value.second,
      value.millisecond,
    ) + Number(milliseconds);
  const days = Math.floor(local / MS_PER_DAY);
  const time = local - days * MS_PER_DAY;
  const date = civilFromDays(days);
  return {
    ...date,
    hour: keep(value.hour, Math.floor(time / MS_PER_HOUR)),
    minute: keep(value.minute, Math.floor(time / MS_PER_MINUTE) % 60),
    second: keep(value.second, Math.floor(time / MS_PER_SECOND) % 60),
    millisecond: keep(value.millisecond, time % MS_PER_SECOND),
    offsetMinutes: value.offsetMinutes,
  };
}

function addToTime(value: TimeValue, amount: DecimalAmount, unit: CalendarUnit): TimeValue {
  if (unit !== 'hour' && unit !== 'minute' && unit !== 'second' && unit !== 'millisecond') {
    throw new FhirPathEvaluationError(
      'eval/invalid-calendar-unit',
      'A Time can only be changed by hours, minutes, seconds or milliseconds',
    );
  }
  const step = MILLISECONDS[value.precision];
  const shift = (fixedMilliseconds(amount, unit) / step) * step;
  const start =
    value.hour * MS_PER_HOUR +
    (value.minute ?? 0) * MS_PER_MINUTE +
    (value.second ?? 0) * MS_PER_SECOND +
    (value.millisecond ?? 0);
  // Time is cyclic: wrap around midnight (3.0.0).
  const time = modulo(start + Number(shift % MILLISECONDS.day), MS_PER_DAY);
  return TimeValue.create({
    hour: Math.floor(time / MS_PER_HOUR),
    minute: keep(value.minute, Math.floor(time / MS_PER_MINUTE) % 60),
    second: keep(value.second, Math.floor(time / MS_PER_SECOND) % 60),
    millisecond: keep(value.millisecond, time % MS_PER_SECOND),
  });
}

function fieldsOf(value: DateTimeValue): DateTimeFields {
  return {
    year: value.year,
    month: value.month,
    day: value.day,
    hour: value.hour,
    minute: value.minute,
    second: value.second,
    millisecond: value.millisecond,
    offsetMinutes: value.offsetMinutes,
  };
}

/** The day, moved back to the last day of the month if the month is shorter. */
function clampDay(
  year: number,
  month: number | undefined,
  day: number | undefined,
): number | undefined {
  return month === undefined || day === undefined ? day : Math.min(day, daysInMonth(year, month));
}

/** A component of the result, present only if the original value had it. */
function keep(original: number | undefined, value: number): number | undefined {
  return original === undefined ? undefined : value;
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** `amount × factor`, truncated toward zero. */
function truncatedMultiple(amount: DecimalAmount, factor: bigint): bigint {
  if (amount.scale <= 0) {
    return amount.coefficient * factor * 10n ** BigInt(-amount.scale);
  }
  const product = amount.coefficient * factor;
  // With at least as many fractional digits as the product has digits, |amount × factor| < 1.
  // Checking first avoids building 10^scale for a huge scale.
  const digits = (product < 0n ? -product : product).toString().length;
  if (amount.scale >= digits) {
    return 0n;
  }
  return product / 10n ** BigInt(amount.scale);
}

/** The amount as an exact decimal. */
function toDecimalAmount(amount: CalendarAmount): DecimalAmount {
  if (typeof amount === 'number') {
    return decimalFromNumber(amount);
  }
  if (!Number.isSafeInteger(amount.scale)) {
    throw invalidAmount();
  }
  return amount;
}

/** The exact decimal value of a finite number, from its shortest round-trip string. */
function decimalFromNumber(amount: number): DecimalAmount {
  if (!Number.isFinite(amount)) {
    throw invalidAmount();
  }
  if (Number.isInteger(amount)) {
    return { coefficient: BigInt(amount), scale: 0 };
  }
  // A non-integer double is below 2^53, so its string is `d.ddd` or `d.ddde-n`.
  const [mantissa = '', exponent = '0'] = String(amount).split('e');
  const [whole = '', fraction = ''] = mantissa.split('.');
  return { coefficient: BigInt(whole + fraction), scale: fraction.length - Number(exponent) };
}

function invalidAmount(): FhirPathEvaluationError {
  return new FhirPathEvaluationError(
    'eval/invalid-argument',
    'Expected a finite amount for date/time arithmetic',
  );
}

function outOfRange(): FhirPathEvaluationError {
  return new FhirPathEvaluationError(
    'eval/datetime-out-of-range',
    'The result of date/time arithmetic is outside the range 0001 to 9999',
  );
}
