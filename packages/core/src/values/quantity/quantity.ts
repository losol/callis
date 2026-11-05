import type { Decimal } from '../decimal/decimal.ts';
import { CALENDAR_UNITS, normalizeCalendarUnit } from './calendar-units.ts';

/** Immutable System.Quantity. Unit validity is deliberately delegated to a UnitSystem. */
export class Quantity {
  readonly value: Decimal;
  readonly unit: string;

  constructor(value: Decimal, unit: string = '1') {
    this.value = value;
    this.unit = normalizeCalendarUnit(unit);
    Object.freeze(this);
  }

  /** FHIRPath quantity text, with singular calendar keywords and quoted UCUM codes.
   * @see https://hl7.org/fhirpath/N1/#tostring-string
   */
  toString(): string {
    const calendar = CALENDAR_UNITS.some((unit) => unit === this.unit);
    const unit = calendar
      ? this.unit
      : `'${this.unit.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\f/g, '\\f')}'`;
    return `${this.value.toString()} ${unit}`;
  }
}
