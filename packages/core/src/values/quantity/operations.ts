import { Decimal } from '../decimal/decimal.ts';
import { CALENDAR_UCUM, CALENDAR_UNITS, normalizeCalendarUnit } from './calendar-units.ts';
import { Quantity } from './quantity.ts';
import { minimalUnitSystem, type UnitSystem } from './unit-system.ts';

/** Compare quantities after converting the right value into the left unit.
 * @see https://hl7.org/fhirpath/STU3/#quantity-equality
 */
export function compareQuantity(
  a: Quantity,
  b: Quantity,
  units: UnitSystem = minimalUnitSystem,
): -1 | 0 | 1 | undefined {
  const value = units.convert(b.value, b.unit, a.unit);
  return value === undefined ? undefined : a.value.compare(value);
}

/** Quantity equality; incomparable units give empty.
 * @see https://hl7.org/fhirpath/STU3/#quantity-equality
 */
export function quantityEquals(
  a: Quantity,
  b: Quantity,
  units: UnitSystem = minimalUnitSystem,
): boolean | undefined {
  const result = compareQuantity(a, b, units);
  return result === undefined ? undefined : result === 0;
}

/** Quantity equivalence additionally relates calendar year/month and a/mo.
 * @see https://hl7.org/fhirpath/STU3/#quantity-equivalence
 */
export function quantityEquivalent(
  a: Quantity,
  b: Quantity,
  units: UnitSystem = minimalUnitSystem,
): boolean | undefined {
  const unit = selectUnit(a.unit, b.unit, units, false, true);
  if (unit === undefined) return undefined;
  const left = units.convert(a.value, a.unit, unit, { equivalence: true });
  const right = units.convert(b.value, b.unit, unit, { equivalence: true });
  return left === undefined || right === undefined ? undefined : left.equivalent(right);
}

/** Converts to a requested unit with equality semantics, retaining the requested spelling. */
export function convertQuantity(
  value: Quantity,
  unit: string,
  units: UnitSystem = minimalUnitSystem,
): Quantity | undefined {
  return wrap(units.convert(value.value, value.unit, unit), unit);
}

/** Adds compatible quantities in the most granular unit; overflow gives empty.
 * @see https://hl7.org/fhirpath/N1/#addition
 */
export function addQuantity(
  a: Quantity,
  b: Quantity,
  units: UnitSystem = minimalUnitSystem,
): Quantity | undefined {
  return additive(a, b, units, false);
}

/** Subtracts compatible quantities in the most granular unit; overflow gives empty.
 * @see https://hl7.org/fhirpath/N1/#subtraction
 */
export function subtractQuantity(
  a: Quantity,
  b: Quantity,
  units: UnitSystem = minimalUnitSystem,
): Quantity | undefined {
  return additive(a, b, units, true);
}

/** Multiplies quantities using the provider's unit algebra and scale factor.
 * @see https://hl7.org/fhirpath/N1/#multiplication
 */
export function multiplyQuantity(
  a: Quantity,
  b: Quantity,
  units: UnitSystem = minimalUnitSystem,
): Quantity | undefined {
  const product = units.multiply(a.unit, b.unit);
  if (product === undefined) return undefined;
  return wrap(a.value.multiply(b.value)?.multiply(product.factor), product.unit);
}

/** Divides quantities using the provider's unit algebra; division by zero gives empty.
 * @see https://hl7.org/fhirpath/N1/#division
 */
export function divideQuantity(
  a: Quantity,
  b: Quantity,
  units: UnitSystem = minimalUnitSystem,
): Quantity | undefined {
  const product = units.divide(a.unit, b.unit);
  if (product === undefined) return undefined;
  return wrap(a.value.multiply(product.factor)?.divide(b.value), product.unit);
}

function wrap(value: Decimal | undefined, unit: string): Quantity | undefined {
  return value === undefined ? undefined : new Quantity(value, unit);
}

function selectUnit(
  a: string,
  b: string,
  units: UnitSystem,
  finer: boolean,
  equivalence = false,
): string | undefined {
  const ratio = units.convert(Decimal.ONE, a, b, { equivalence });
  if (ratio === undefined) return undefined;
  const order = ratio.compare(Decimal.ONE);
  return order === 0 || (finer ? order < 0 : order > 0) ? a : b;
}

function additive(
  a: Quantity,
  b: Quantity,
  units: UnitSystem,
  subtract: boolean,
): Quantity | undefined {
  if (a.unit !== b.unit && [a.unit, b.unit].some((unit) => unit === 'year' || unit === 'month'))
    return undefined;
  let unit = selectUnit(a.unit, b.unit, units, true);
  if (unit === undefined) return undefined;
  // Cross-system time arithmetic is expressed in calendar units.
  // https://hl7.org/fhirpath/STU3/en/index.html#addition
  if (CALENDAR_UNITS.some((keyword) => keyword === a.unit || keyword === b.unit)) {
    for (const keyword of CALENDAR_UNITS) {
      if (CALENDAR_UCUM[keyword] === unit) unit = keyword;
    }
  }
  unit = normalizeCalendarUnit(unit);
  const left = units.convert(a.value, a.unit, unit);
  const right = units.convert(b.value, b.unit, unit);
  return left === undefined || right === undefined
    ? undefined
    : wrap(subtract ? left.subtract(right) : left.add(right), unit);
}
