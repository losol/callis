import { FhirPathEvaluationError } from '../../errors/fhirpath-error.ts';
import { timePrecisionOf } from './calendar.ts';
import { formatTimePart } from './format.ts';
import type { TimePrecision } from './precision.ts';

/** The components of a {@link TimeValue}. A component may only be present if the coarser ones are. */
export interface TimeFields {
  readonly hour: number;
  readonly minute?: number | undefined;
  readonly second?: number | undefined;
  readonly millisecond?: number | undefined;
}

/**
 * A FHIRPath `System.Time`: a time of day with hour to millisecond precision, in the range
 * 00:00:00.000 to 23:59:59.999. Time values have no timezone. Values are immutable and always
 * valid.
 *
 * @see https://hl7.org/fhirpath/N1/#time
 */
export class TimeValue {
  readonly hour: number;
  readonly minute: number | undefined;
  readonly second: number | undefined;
  readonly millisecond: number | undefined;
  readonly precision: TimePrecision;

  private constructor(fields: TimeFields, precision: TimePrecision) {
    this.hour = fields.hour;
    this.minute = fields.minute;
    this.second = fields.second;
    this.millisecond = fields.millisecond;
    this.precision = precision;
  }

  /**
   * Creates a time, or returns undefined if the components are not a valid time of day: out of
   * range, not integers, or a component without the coarser ones.
   */
  static tryCreate(fields: TimeFields): TimeValue | undefined {
    const precision = timePrecisionOf(
      fields.hour,
      fields.minute,
      fields.second,
      fields.millisecond,
    );
    return precision === undefined ? undefined : new TimeValue(fields, precision);
  }

  /**
   * Creates a time.
   *
   * @throws FhirPathEvaluationError `eval/datetime-out-of-range` if the components are not a valid
   * time of day.
   */
  static create(fields: TimeFields): TimeValue {
    const value = TimeValue.tryCreate(fields);
    if (value === undefined) {
      throw new FhirPathEvaluationError(
        'eval/datetime-out-of-range',
        'Expected a valid time between 00:00:00.000 and 23:59:59.999',
      );
    }
    return value;
  }

  /**
   * The FHIRPath string form, `hh:mm:ss.fff` to the value's precision. This is also the FHIR JSON
   * format of a `time` when the value has seconds.
   *
   * @see https://hl7.org/fhirpath/N1/#tostring-string
   */
  toString(): string {
    return formatTimePart(this.hour, this.minute, this.second, this.millisecond);
  }

  /** The FHIRPath literal, for example `@T14:30`. */
  toLiteral(): string {
    return `@T${this.toString()}`;
  }

  /** The FHIR JSON form, so that `JSON.stringify` writes a FHIR `time`. */
  toJSON(): string {
    return this.toString();
  }
}
