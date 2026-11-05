/** Calendar and definite-duration relationships from FHIRPath 3.0.0.
 * @see https://hl7.org/fhirpath/STU3/#time-valued-quantities
 */
export const CALENDAR_UNITS: readonly CalendarUnit[] = Object.freeze([
  'year',
  'month',
  'week',
  'day',
  'hour',
  'minute',
  'second',
  'millisecond',
] as const);

/** Singular calendar keyword. */
export type CalendarUnit =
  | 'year'
  | 'month'
  | 'week'
  | 'day'
  | 'hour'
  | 'minute'
  | 'second'
  | 'millisecond';

/** Normalizes calendar keywords, preserving case-sensitive UCUM codes. */
export function normalizeCalendarUnit(unit: string): string {
  for (const keyword of CALENDAR_UNITS) {
    if (unit === keyword || unit === `${keyword}s`) return keyword;
  }
  return unit;
}

/** UCUM counterpart of each calendar keyword; year/month are equivalent only. */
export const CALENDAR_UCUM: Readonly<Record<CalendarUnit, string>> = Object.freeze({
  year: 'a',
  month: 'mo',
  week: 'wk',
  day: 'd',
  hour: 'h',
  minute: 'min',
  second: 's',
  millisecond: 'ms',
});

/** Returns the definite-duration counterpart, except for calendar year/month. */
export function definiteUnit(unit: string, equivalence = false): string | undefined {
  const normalized = normalizeCalendarUnit(unit);
  if (!Object.hasOwn(CALENDAR_UCUM, normalized)) return normalized;
  if ((normalized === 'year' || normalized === 'month') && !equivalence) return undefined;
  for (const keyword of CALENDAR_UNITS) {
    if (keyword === normalized) return CALENDAR_UCUM[keyword];
  }
  return undefined;
}

/** Calendar magnitude of a keyword or a supported UCUM time code. */
export function timeUnitMagnitude(unit: string): CalendarUnit | undefined {
  const normalized = normalizeCalendarUnit(unit);
  return CALENDAR_UNITS.find(
    (keyword) => keyword === normalized || CALENDAR_UCUM[keyword] === normalized,
  );
}

/** Whether a spelling denotes the calendar code system (rather than UCUM). */
export function isCalendarUnit(unit: string): boolean {
  const normalized = normalizeCalendarUnit(unit);
  return CALENDAR_UNITS.some((keyword) => keyword === normalized);
}
