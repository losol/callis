import type { DateValue } from './date.ts';
import type { DateTimeValue } from './datetime.ts';
import type { TimeValue } from './time.ts';

/** Any FHIRPath date/time value: `System.Date`, `System.DateTime` or `System.Time`. */
export type TemporalValue = DateValue | DateTimeValue | TimeValue;
