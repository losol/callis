/**
 * Text formatting shared by the date/time value types. Partial values are written only to their own
 * precision ([N1 §5.5.8, toString()](https://hl7.org/fhirpath/N1/#tostring-string)).
 */

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
export function formatDatePart(
  year: number,
  month: number | undefined,
  day: number | undefined,
): string {
  let text = pad(year, 4);
  if (month !== undefined) {
    text += `-${pad(month, 2)}`;
    if (day !== undefined) {
      text += `-${pad(day, 2)}`;
    }
  }
  return text;
}

/** `hh`, `hh:mm`, `hh:mm:ss` or `hh:mm:ss.fff`. Milliseconds always have three digits. */
export function formatTimePart(
  hour: number,
  minute: number | undefined,
  second: number | undefined,
  millisecond: number | undefined,
): string {
  let text = pad(hour, 2);
  if (minute !== undefined) {
    text += `:${pad(minute, 2)}`;
    if (second !== undefined) {
      text += `:${pad(second, 2)}`;
      if (millisecond !== undefined) {
        text += `.${pad(millisecond, 3)}`;
      }
    }
  }
  return text;
}

/** `Z` for a zero offset, otherwise `+hh:mm` or `-hh:mm`. */
export function formatOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) {
    return 'Z';
  }
  const sign = offsetMinutes < 0 ? '-' : '+';
  const magnitude = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(magnitude / 60), 2)}:${pad(magnitude % 60, 2)}`;
}
