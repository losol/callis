import {
  Decimal,
  isWithinDecimalBounds,
  MAX_DECIMAL_DIGITS,
} from '../../src/values/decimal/decimal.ts';
import {
  minimalUnitSystem,
  type UnitConversionOptions,
  type UnitProduct,
  type UnitSystem,
} from '../../src/values/quantity/unit-system.ts';

/** Small exact length provider for downstream tests, deliberately not a full UCUM parser.
 * Supports m/cm/cm2 plus the minimal provider. Algebra returns nontrivial factors to exercise
 * consumers that canonicalize scaled products and quotients.
 */
export const stubUnitSystem: UnitSystem = {
  parse(unit) {
    return ['m', 'cm', 'cm2', 'm2'].includes(unit) ? { unit } : minimalUnitSystem.parse(unit);
  },
  convert(
    value: Decimal,
    from: string,
    to: string,
    options?: UnitConversionOptions,
  ): Decimal | undefined {
    if (from === 'cm' && to === 'm') return rescale(value, 2);
    if (from === 'm' && to === 'cm') return rescale(value, -2);
    return minimalUnitSystem.convert(value, from, to, options);
  },
  multiply(a: string, b: string): UnitProduct | undefined {
    if (a === 'cm' && b === 'cm') return { unit: 'm2', factor: Decimal.of(1n, 4) };
    return minimalUnitSystem.multiply(a, b);
  },
  divide(a: string, b: string): UnitProduct | undefined {
    if (a === 'cm2' && b === 'cm') return { unit: 'cm', factor: Decimal.ONE };
    if (a === 'cm' && b === 'm') return { unit: '1', factor: Decimal.of(1n, 2) };
    return minimalUnitSystem.divide(a, b);
  },
};

// Unit conversion preserves supported digits; arithmetic division may round even finite ratios.
function rescale(value: Decimal, places: number): Decimal | undefined {
  let coefficient = value.coefficient;
  let scale = value.scale + places;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  // A coefficient zero can be canceled before rejecting a representable scale-limit value.
  while (scale > MAX_DECIMAL_DIGITS && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale--;
  }
  return isWithinDecimalBounds(coefficient, scale) ? Decimal.of(coefficient, scale) : undefined;
}
