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
import type { UnitSystem } from '../src/values/quantity/unit-system.ts';
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

  it('selects the least granular unit using intervals for affine providers', () => {
    // Synthetic offset units: 1 wide = 2 narrow in interval size, origin -100 narrow.
    // This exercises the contract required by T0007 special (non-ratio) units.
    const affine: UnitSystem = {
      ...stubUnitSystem,
      multiply: () => undefined,
      divide: () => undefined,
      convert(value, from, to, options) {
        if (from === 'wide' && to === 'narrow')
          return value.multiply(Decimal.of(2n))?.subtract(Decimal.of(100n));
        if (from === 'narrow' && to === 'wide')
          return value.add(Decimal.of(100n))?.divide(Decimal.of(2n));
        return stubUnitSystem.convert(value, from, to, options);
      },
    };
    const narrow = new Quantity(Decimal.of(-971n, 1), 'narrow');
    expect(quantityEquivalent(q(1, 'wide'), narrow, affine)).toBe(true);
    expect(quantityEquivalent(narrow, q(1, 'wide'), affine)).toBe(true);
    expect(quantityEquals(q(1, 'wide'), narrow, affine)).toBe(false);
    expect(convertQuantity(q(1, 'wide'), 'narrow', affine)?.value.toString()).toBe('-98');
    expect(convertQuantity(q(-98, 'narrow'), 'wide', affine)?.value.toString()).toBe('1');
    expect(multiplyQuantity(q(1, 'wide'), q(1, 'narrow'), affine)).toBeUndefined();
    expect(divideQuantity(q(1, 'wide'), q(1, 'narrow'), affine)).toBeUndefined();
    expect(multiplyQuantity(q(1, 'wide'), q(1, 'wide'), affine)).toBeUndefined();
    expect(divideQuantity(q(1, 'wide'), q(1, 'wide'), affine)).toBeUndefined();
  });

  it('keeps rational scales exact in both algebra kernels', () => {
    const rational: UnitSystem = {
      ...stubUnitSystem,
      multiply: () => ({ unit: 'm2', factor: Decimal.ONE, divisor: Decimal.of(60n) }),
      divide: () => ({ unit: '1', factor: Decimal.ONE, divisor: Decimal.of(60n) }),
    };
    expect(multiplyQuantity(q(60, 'cm'), q(1, 'cm'), rational)?.value.toString()).toBe('1');
    expect(divideQuantity(q(60, 'cm'), q(1, 'cm'), rational)?.value.toString()).toBe('1');
  });

  it.each([
    [Decimal.ZERO, undefined],
    [Decimal.of(-1n), undefined],
    [Decimal.ONE, Decimal.ZERO],
    [Decimal.ONE, Decimal.of(-1n)],
  ])('returns empty for invalid algebra scales', (factor, divisor) => {
    const invalid: UnitSystem = {
      ...stubUnitSystem,
      multiply: () =>
        divisor === undefined ? { unit: 'm2', factor } : { unit: 'm2', factor, divisor },
      divide: () =>
        divisor === undefined ? { unit: '1', factor } : { unit: '1', factor, divisor },
    };
    expect(multiplyQuantity(q(1, 'cm'), q(1, 'cm'), invalid)).toBeUndefined();
    expect(divideQuantity(q(1, 'cm'), q(1, 'cm'), invalid)).toBeUndefined();
  });

  // https://hl7.org/fhirpath/STU3/#math-1
  it('propagates underflow in a provider algebra factor', () => {
    const tiny = new Quantity(Decimal.of(1n, MAX_DECIMAL_DIGITS), 'cm');
    expect(multiplyQuantity(tiny, q(1, 'cm'), stubUnitSystem)).toBeUndefined();
    expect(divideQuantity(tiny, q(1, 'm'), stubUnitSystem)).toBeUndefined();
    const excessive = Decimal.of(10n ** BigInt(MAX_DECIMAL_DIGITS) - 1n);
    const rational: UnitSystem = {
      ...stubUnitSystem,
      divide: () => ({ unit: '1', factor: Decimal.ONE, divisor: excessive }),
    };
    expect(divideQuantity(q(1, 'cm'), q(2, 'cm'), rational)).toBeUndefined();
  });
});
