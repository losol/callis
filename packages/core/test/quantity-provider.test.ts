import { describe, expect, it } from 'vitest';
import { Decimal, MAX_DECIMAL_DIGITS } from '../src/values/decimal/decimal.ts';
import {
  addQuantity,
  compareQuantity,
  convertQuantity,
  divideQuantity,
  multiplyQuantity,
  quantityEquals,
  quantityEquivalent,
  subtractQuantity,
} from '../src/values/quantity/operations.ts';
import { Quantity } from '../src/values/quantity/quantity.ts';
import { stubUnitSystem } from './support/stub-unit-system.ts';

// https://hl7.org/fhirpath/N1/#quantity
describe('substitutable UnitSystem', () => {
  const q = (n: number, unit: string): Quantity => new Quantity(Decimal.fromInteger(n), unit);
  it('uses provider conversions throughout comparisons and additive kernels', () => {
    expect(quantityEquals(q(1, 'm'), q(100, 'cm'), stubUnitSystem)).toBe(true);
    expect(quantityEquivalent(q(1, 'm'), q(100, 'cm'), stubUnitSystem)).toBe(true);
    expect(compareQuantity(q(1, 'cm'), q(1, 'm'), stubUnitSystem)).toBe(-1);
    expect(convertQuantity(q(1, 'm'), 'cm', stubUnitSystem)?.toString()).toBe("100 'cm'");
    expect(addQuantity(q(1, 'm'), q(100, 'cm'), stubUnitSystem)?.toString()).toBe("200 'cm'");
    expect(subtractQuantity(q(2, 'm'), q(100, 'cm'), stubUnitSystem)?.toString()).toBe("100 'cm'");
    expect(stubUnitSystem.parse('cm')?.unit).toBe('cm');
    expect(stubUnitSystem.parse('s')?.unit).toBe('s');
    expect(quantityEquals(q(1, 'year'), q(1, 'a'), stubUnitSystem)).toBeUndefined();
    expect(quantityEquivalent(q(1, 'year'), q(1, 'a'), stubUnitSystem)).toBe(true);
    expect(compareQuantity(q(1, 'year'), q(1, 'a'), stubUnitSystem)).toBeUndefined();
  });

  it('applies factors to compound units as well as dimensionless quotients', () => {
    expect(
      multiplyQuantity(q(10, 'cm'), q(20, 'cm'), stubUnitSystem)?.value.equals(Decimal.of(2n, 2)),
    ).toBe(true);
    expect(multiplyQuantity(q(10, 'cm'), q(20, 'cm'), stubUnitSystem)?.unit).toBe('m2');
    expect(divideQuantity(q(12, 'cm2'), q(3, 'cm'), stubUnitSystem)?.toString()).toBe("4 'cm'");
    expect(divideQuantity(q(100, 'cm'), q(1, 'm'), stubUnitSystem)?.value.equals(Decimal.ONE)).toBe(
      true,
    );
    expect(multiplyQuantity(q(1, 'cm'), q(1, 's'), stubUnitSystem)).toBeUndefined();
    expect(divideQuantity(q(1, 'cm'), q(1, 's'), stubUnitSystem)).toBeUndefined();
    expect(convertQuantity(q(1, 'cm'), 's', stubUnitSystem)).toBeUndefined();
  });

  // https://hl7.org/fhirpath/STU3/#math-1
  it('propagates underflow in a provider algebra factor', () => {
    const tiny = new Quantity(Decimal.of(1n, MAX_DECIMAL_DIGITS), 'cm');
    expect(multiplyQuantity(tiny, q(1, 'cm'), stubUnitSystem)).toBeUndefined();
    expect(divideQuantity(tiny, q(1, 'm'), stubUnitSystem)).toBeUndefined();
  });
});
