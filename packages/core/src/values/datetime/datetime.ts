import { FhirPathEvaluationError } from '../../errors/fhirpath-error.ts';
import { datePrecisionOf, isValidOffset, timePrecisionOf } from './calendar.ts';
import type { DateFields } from './date.ts';
import { DateValue } from './date.ts';
import { formatDatePart, formatOffset, formatTimePart } from './format.ts';
import type { Precision } from './precision.ts';

/**
 * The components of a {@link DateTimeValue}. A component may only be present if the coarser ones
 * are; time components need a full date, and an offset needs at least the hour.
 */
export interface DateTimeFields extends DateFields {
  readonly hour?: number | undefined;
  readonly minute?: number | undefined;
  readonly second?: number | undefined;
  readonly millisecond?: number | undefined;
  /** Timezone offset in minutes east of UTC (`+01:00` is 60, `Z` is 0); undefined if none. */
  readonly offsetMinutes?: number | undefined;
}

/**
 * A FHIRPath `System.DateTime`: a date and time with year to millisecond precision and an optional
 * timezone offset, in the range 0001-01-01T00:00:00.000 to 9999-12-31T23:59:59.999. Values are
 * immutable and always valid.
 *
 * @see https://hl7.org/fhirpath/N1/#datetime
 */
export class DateTimeValue {
  readonly year: number;
  readonly month: number | undefined;
  readonly day: number | undefined;
  readonly hour: number | undefined;
  readonly minute: number | undefined;
  readonly second: number | undefined;
  readonly millisecond: number | undefined;
  /** Minutes east of UTC; undefined when the value has no timezone. `Z` is 0. */
  readonly offsetMinutes: number | undefined;
  readonly precision: Precision;

  private constructor(fields: DateTimeFields, precision: Precision) {
    this.year = fields.year;
    this.month = fields.month;
    this.day = fields.day;
    this.hour = fields.hour;
    this.minute = fields.minute;
    this.second = fields.second;
    this.millisecond = fields.millisecond;
    this.offsetMinutes = fields.offsetMinutes;
    this.precision = precision;
  }

  /**
   * Creates a date/time, or returns undefined if the components are not valid: out of range, not
   * integers, a component without the coarser ones, a time without a full date, an offset without
   * a time, or an offset beyond ±14:00.
   */
  static tryCreate(fields: DateTimeFields): DateTimeValue | undefined {
    const datePrecision = datePrecisionOf(fields.year, fields.month, fields.day);
    if (datePrecision === undefined) {
      return undefined;
    }
    if (fields.hour === undefined) {
      const hasTimeParts =
        fields.minute !== undefined ||
        fields.second !== undefined ||
        fields.millisecond !== undefined ||
        fields.offsetMinutes !== undefined;
      return hasTimeParts ? undefined : new DateTimeValue(fields, datePrecision);
    }
    if (datePrecision !== 'day') {
      return undefined;
    }
    const timePrecision = timePrecisionOf(
      fields.hour,
      fields.minute,
      fields.second,
      fields.millisecond,
    );
    if (timePrecision === undefined) {
      return undefined;
    }
    if (fields.offsetMinutes !== undefined && !isValidOffset(fields.offsetMinutes)) {
      return undefined;
    }
    return new DateTimeValue(fields, timePrecision);
  }

  /**
   * Creates a date/time.
   *
   * @throws FhirPathEvaluationError `eval/datetime-out-of-range` if the components are not valid
   * (see {@link DateTimeValue.tryCreate}).
   */
  static create(fields: DateTimeFields): DateTimeValue {
    const value = DateTimeValue.tryCreate(fields);
    if (value === undefined) {
      throw new FhirPathEvaluationError(
        'eval/datetime-out-of-range',
        'Expected a valid date/time between 0001-01-01T00:00:00.000 and 9999-12-31T23:59:59.999 with an offset within ±14:00',
      );
    }
    return value;
  }

  /**
   * The implicit Date → DateTime conversion: the same year, month and day, with no time and no
   * timezone.
   *
   * @see https://hl7.org/fhirpath/N1/#conversion
   */
  static fromDate(date: DateValue): DateTimeValue {
    return new DateTimeValue(date, date.precision);
  }

  /**
   * The date part (year, month and day, to the value's precision), taken as written, without
   * converting the timezone.
   *
   * @see https://hl7.org/fhirpath/N1/#todate-date
   */
  toDateValue(): DateValue {
    return DateValue.create(this);
  }

  /**
   * The FHIRPath string form, `YYYY-MM-DDThh:mm:ss.fff(+|-)hh:mm` to the value's precision. A zero
   * offset is written as `Z`. This is also the FHIR JSON format of a `dateTime` or `instant`.
   *
   * @see https://hl7.org/fhirpath/N1/#tostring-string
   */
  toString(): string {
    const date = formatDatePart(this.year, this.month, this.day);
    return this.hour === undefined ? date : `${date}T${this.formatTime(this.hour)}`;
  }

  /** The FHIRPath literal, for example `@2014-01-25T14:30Z`, or `@2014T` for a year-only value. */
  toLiteral(): string {
    const date = formatDatePart(this.year, this.month, this.day);
    return this.hour === undefined ? `@${date}T` : `@${date}T${this.formatTime(this.hour)}`;
  }

  /** The FHIR JSON form, so that `JSON.stringify` writes a FHIR `dateTime`. */
  toJSON(): string {
    return this.toString();
  }

  private formatTime(hour: number): string {
    const time = formatTimePart(hour, this.minute, this.second, this.millisecond);
    return this.offsetMinutes === undefined ? time : time + formatOffset(this.offsetMinutes);
  }
}
