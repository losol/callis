import { FhirPathEvaluationError } from '../../errors/fhirpath-error.ts';
import { datePrecisionOf } from './calendar.ts';
import { formatDatePart } from './format.ts';
import type { DatePrecision } from './precision.ts';

/** The components of a {@link DateValue}. A component may only be present if the coarser ones are. */
export interface DateFields {
  readonly year: number;
  readonly month?: number | undefined;
  readonly day?: number | undefined;
}

/**
 * A FHIRPath `System.Date`: a date with year, month or day precision and no timezone, in the range
 * 0001-01-01 to 9999-12-31. Values are immutable and always valid.
 *
 * @see https://hl7.org/fhirpath/N1/#date
 */
export class DateValue {
  /** The year, 1–9999. */
  readonly year: number;
  /** The month, 1–12; undefined when the precision is coarser than month. */
  readonly month: number | undefined;
  /** The day of the month, 1–31; undefined when the precision is coarser than day. */
  readonly day: number | undefined;
  /** The finest component the value has. */
  readonly precision: DatePrecision;

  private constructor(fields: DateFields, precision: DatePrecision) {
    this.year = fields.year;
    this.month = fields.month;
    this.day = fields.day;
    this.precision = precision;
    Object.freeze(this);
  }

  /**
   * Creates a date, or returns undefined if the components are not a valid date: out of range,
   * not integers, or a day without a month.
   */
  static tryCreate(fields: DateFields): DateValue | undefined {
    const precision = datePrecisionOf(fields.year, fields.month, fields.day);
    return precision === undefined ? undefined : new DateValue(fields, precision);
  }

  /**
   * Creates a date.
   *
   * @throws FhirPathEvaluationError `eval/datetime-out-of-range` if the components are not a valid
   * date.
   */
  static create(fields: DateFields): DateValue {
    const value = DateValue.tryCreate(fields);
    if (value === undefined) {
      throw new FhirPathEvaluationError(
        'eval/datetime-out-of-range',
        'Expected a valid date between 0001-01-01 and 9999-12-31',
      );
    }
    return value;
  }

  /**
   * The FHIRPath string form, `YYYY-MM-DD` to the value's precision. This is also the FHIR JSON
   * format of a `date`.
   *
   * @see https://hl7.org/fhirpath/N1/#tostring-string
   */
  toString(): string {
    return formatDatePart(this.year, this.month, this.day);
  }

  /** The FHIRPath literal, for example `@2014-01`. */
  toLiteral(): string {
    return `@${this.toString()}`;
  }

  /** The FHIR JSON form, so that `JSON.stringify` writes a FHIR `date`. */
  toJSON(): string {
    return this.toString();
  }
}
