/** The precisions a Date can have. */
export type DatePrecision = 'year' | 'month' | 'day';

/** The precisions a Time can have. */
export type TimePrecision = 'hour' | 'minute' | 'second' | 'millisecond';

/**
 * The precision of a date/time value: the finest component it has.
 *
 * Seconds and milliseconds count as one precision when values are compared
 * ([N1 Date/Time equality](https://hl7.org/fhirpath/N1/#datetime-equality)), but they stay
 * distinct here so that `toString()` can write what the value was created with.
 */
export type Precision = DatePrecision | TimePrecision;
