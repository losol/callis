import { describe, expect, it } from 'vitest';
import { Decimal, MAX_DECIMAL_DIGITS } from '../decimal/decimal.ts';
import { fromFhirQuantity } from './fhir-quantity.ts';
import {
  addQuantity,
  compareQuantity,
  convertQuantity,
  divideQuantity,
  multiplyQuantity,
  quantityEquals,
  quantityEquivalent,
  subtractQuantity,
} from './operations.ts';
import { Quantity } from './quantity.ts';
import { minimalUnitSystem } from './unit-system.ts';

function quantity(value: number, unit: string): Quantity {
  return new Quantity(Decimal.fromInteger(value), unit);
}

// https://hl7.org/fhirpath/STU3/#time-valued-quantities
// https://hl7.org/fhirpath/STU3/#quantity-equality
// https://hl7.org/fhirpath/STU3/#quantity-equivalence
describe('quantity time table', () => {
  it.each([
    [1, 'year', 1, 'a', undefined, true, undefined], // testEquality36
    [1, 'month', 1, 'mo', undefined, true, undefined],
    [7, 'days', 1, 'wk', true, true, 0], // testQuantity6
    [1, 'second', 1, 's', true, true, 0],
    [10, 'seconds', 1, 's', false, false, 1],
    [1, 'year', 12, 'months', true, true, 0],
    [1, 'a', 1, 'year', undefined, true, undefined],
    [1, 'mo', 1, 'month', undefined, true, undefined],
    [1, 'wk', 7, 'days', true, true, 0],
    [1, 'a', 365, 'd', false, true, 1],
    [1, 'mo', 30, 'd', false, true, 1],
    [1, 'g', 1000, 'mg', undefined, false, undefined],
    [1, 'kg', 1, 's', undefined, false, undefined],
    [1, 'opaque', 1, 'opaque', true, true, 0],
  ] as const)('%s %s compared with %s %s', (av, au, bv, bu, equal, equivalent, order) => {
    const a = quantity(av, au);
    const b = quantity(bv, bu);
    expect(quantityEquals(a, b)).toBe(equal);
    expect(quantityEquivalent(a, b)).toBe(equivalent);
    expect(compareQuantity(a, b)).toBe(order);
    expect(quantityEquals(b, a)).toBe(equal);
    expect(quantityEquivalent(b, a)).toBe(equivalent);
  });

  it.each([
    ['year', 'a'],
    ['month', 'mo'],
    ['week', 'wk'],
    ['day', 'd'],
    ['hour', 'h'],
    ['minute', 'min'],
    ['second', 's'],
    ['millisecond', 'ms'],
  ])('normalizes %s and its plural without changing %s', (calendar, ucum) => {
    expect(quantity(1, `${calendar}s`).unit).toBe(calendar);
    expect(quantity(1, `${calendar}s`).toString()).toBe(`1 ${calendar}`);
    expect(quantity(1, ucum).toString()).toBe(`1 '${ucum}'`);
    expect(minimalUnitSystem.parse(calendar)?.unit).toBe(calendar);
    expect(minimalUnitSystem.parse(`${calendar}s`)?.unit).toBe(calendar);
    expect(minimalUnitSystem.parse(ucum)?.unit).toBe(ucum);
  });

  it('retains Decimal precision, escapes unit text and freezes values', () => {
    const value = new Quantity(Decimal.of(100n, 2), "a'\\\n\r\t\f");
    expect(value.toString()).toBe("1.00 'a\\'\\\\\\n\\r\\t\\f'");
    expect(Object.isFrozen(value)).toBe(true);
    expect(new Quantity(Decimal.ONE).toString()).toBe("1 '1'");
    expect(quantity(1, 'Days').unit).toBe('Days');
  });
});

// https://hl7.org/fhirpath/N1/#math
describe('quantity arithmetic and conversion', () => {
  it('adds/subtracts converted values in the most granular unit', () => {
    expect(addQuantity(quantity(1, 'min'), quantity(30, 's'))?.toString()).toBe("90 's'");
    expect(subtractQuantity(quantity(1, 'min'), quantity(90, 's'))?.toString()).toBe("-30 's'");
    expect(convertQuantity(quantity(2, 'h'), 'minutes')?.toString()).toBe('120 minute');
    expect(addQuantity(quantity(1, 'year'), quantity(1, 'a'))).toBeUndefined();
    expect(subtractQuantity(quantity(1, 'mo'), quantity(1, 'month'))).toBeUndefined();
  });

  it('supports identities and scaled dimensionless quotients without full unit algebra', () => {
    expect(multiplyQuantity(quantity(3, '1'), quantity(2, 'kg'))?.toString()).toBe("6 'kg'");
    expect(multiplyQuantity(quantity(2, 'kg'), quantity(3, '1'))?.toString()).toBe("6 'kg'");
    expect(divideQuantity(quantity(12, 'kg'), quantity(3, '1'))?.toString()).toBe("4 'kg'");
    expect(divideQuantity(quantity(1, 'min'), quantity(30, 's'))?.toString()).toBe("2 '1'");
    expect(divideQuantity(quantity(60, 's'), quantity(1, 'min'))?.toString()).toBe("1 '1'");
    expect(divideQuantity(quantity(1, 'min'), quantity(60, 's'))?.toString()).toBe("1 '1'");
    expect(convertQuantity(quantity(60, 's'), 'min')?.value.toString()).toBe('1');
    expect(convertQuantity(quantity(1, 'min'), 's')?.value.toString()).toBe('60');
    expect(divideQuantity(quantity(3, 'kg'), quantity(3, 'kg'))?.toString()).toBe("1 '1'");
    expect(multiplyQuantity(quantity(1, 'kg'), quantity(1, 'kg'))).toBeUndefined();
    expect(divideQuantity(quantity(1, 'kg'), quantity(1, 's'))).toBeUndefined();
    expect(divideQuantity(quantity(1, 's'), quantity(0, 's'))).toBeUndefined();
  });

  // https://hl7.org/fhirpath/STU3/en/index.html#division
  it.each([
    ['year', 'a'],
    ['month', 'mo'],
    ['week', 'wk'],
    ['day', 'd'],
    ['hour', 'h'],
    ['minute', 'min'],
    ['second', 's'],
    ['millisecond', 'ms'],
  ])('rejects calendar %s cancellation while retaining UCUM %s cancellation', (calendar, ucum) => {
    expect(divideQuantity(quantity(2, calendar), quantity(1, calendar))).toBeUndefined();
    expect(divideQuantity(quantity(2, `${calendar}s`), quantity(1, calendar))).toBeUndefined();
    expect(divideQuantity(quantity(2, ucum), quantity(1, ucum))?.toString()).toBe("2 '1'");
  });

  // https://hl7.org/fhirpath/STU3/en/index.html#division
  it('rejects differing and mixed calendar quotients but retains scalar and UCUM division', () => {
    expect(divideQuantity(quantity(1, 'week'), quantity(1, 'day'))).toBeUndefined();
    expect(divideQuantity(quantity(1, 'day'), quantity(1, 'week'))).toBeUndefined();
    expect(divideQuantity(quantity(1, 'week'), quantity(1, 'd'))).toBeUndefined();
    expect(divideQuantity(quantity(1, 'wk'), quantity(1, 'day'))).toBeUndefined();
    expect(divideQuantity(quantity(1, '1'), quantity(1, 'day'))).toBeUndefined();
    expect(divideQuantity(quantity(2, 'days'), quantity(1, '1'))?.toString()).toBe('2 day');
    expect(divideQuantity(quantity(1, 'wk'), quantity(1, 'd'))?.toString()).toBe("7 '1'");
  });

  it.each(['constructor', '__proto__', 'toString', 'mg', '', 'S'])(
    'handles unsupported %s without throwing',
    (unit) => {
      expect(minimalUnitSystem.parse(unit)).toBeUndefined();
      expect(convertQuantity(quantity(1, unit), 's')).toBeUndefined();
      expect(addQuantity(quantity(1, unit), quantity(1, 's'))).toBeUndefined();
    },
  );

  it('uses calendar factors explicitly and requires explicit conversion before addition', () => {
    expect(convertQuantity(quantity(1, 'year'), 'days')?.value.toString()).toBe('365');
    expect(convertQuantity(quantity(1, 'month'), 'days')?.value.toString()).toBe('30');
    expect(addQuantity(quantity(1, 'year'), quantity(12, 'months'))).toBeUndefined();
    expect(subtractQuantity(quantity(1, 'year'), quantity(12, 'months'))).toBeUndefined();
    expect(quantityEquivalent(quantity(1, 'year'), quantity(11, 'months'))).toBe(true);
    expect(quantityEquivalent(quantity(11, 'months'), quantity(1, 'year'))).toBe(true);
    expect(quantityEquivalent(quantity(1, 'year'), quantity(12, 'mo'))).toBe(true);
    expect(addQuantity(quantity(2, 'minutes'), quantity(60, 's'))?.toString()).toBe('180 second');
    expect(addQuantity(quantity(60, 's'), quantity(2, 'minutes'))?.toString()).toBe('180 second');
  });

  it('preserves exact values and precision across aliases and integer conversion factors', () => {
    const value = Decimal.of(12345678901234567890123456789012345678900n, 2);
    expect(minimalUnitSystem.convert(value, 'second', 's')).toBe(value);
    expect(minimalUnitSystem.convert(value, 's', 'ms')?.coefficient).toBe(
      value.coefficient * 1000n,
    );
    expect(minimalUnitSystem.convert(value, 's', 'ms')?.scale).toBe(value.scale);
  });

  // https://hl7.org/fhirpath/STU3/en/index.html#unit-conversions
  // https://hl7.org/fhirpath/STU3/en/index.html#math-1
  it.each([1n, -1n])(
    'cancels redundant zeros to retain a supported conversion at the Decimal bounds (%s)',
    (sign) => {
      const coefficient = sign * (10n ** BigInt(MAX_DECIMAL_DIGITS) - 1n);
      const value = Decimal.of(coefficient, MAX_DECIMAL_DIGITS);
      const converted = minimalUnitSystem.convert(value, 's', 'ms');
      expect(converted?.coefficient).toBe(coefficient);
      expect(converted?.scale).toBe(MAX_DECIMAL_DIGITS - 3);
      const quantityValue = convertQuantity(new Quantity(value, 's'), 'ms');
      expect(quantityValue?.value.coefficient).toBe(coefficient);
      expect(quantityValue?.value.scale).toBe(MAX_DECIMAL_DIGITS - 3);
      const roundTrip =
        converted === undefined ? undefined : minimalUnitSystem.convert(converted, 'ms', 's');
      expect(roundTrip?.coefficient).toBe(coefficient);
      expect(roundTrip?.scale).toBe(MAX_DECIMAL_DIGITS);
    },
  );

  it('retains identity precision and distinguishes implicit from explicit conversion', () => {
    const value = Decimal.of(100n, 2);
    expect(minimalUnitSystem.convert(value, 'days', 'day')).toBe(value);
    expect(convertQuantity(quantity(1, 'year'), 'a')?.toString()).toBe("1 'a'");
    expect(minimalUnitSystem.convert(Decimal.ONE, 'year', 'a')).toBeUndefined();
    expect(compareQuantity(quantity(1, 'year'), quantity(1, 'd'))).toBeUndefined();
  });

  // https://hl7.org/fhirpath/STU3/#math-1
  it('propagates Decimal overflow/underflow through every arithmetic and conversion path', () => {
    const maximum = Decimal.of(10n ** BigInt(MAX_DECIMAL_DIGITS) - 1n);
    const huge = new Quantity(maximum, 's');
    const tiny = new Quantity(Decimal.of(1n, MAX_DECIMAL_DIGITS), 's');
    expect(addQuantity(huge, quantity(1, 's'))).toBeUndefined();
    expect(subtractQuantity(new Quantity(maximum.negate(), 's'), quantity(1, 's'))).toBeUndefined();
    expect(multiplyQuantity(huge, quantity(2, '1'))).toBeUndefined();
    expect(divideQuantity(tiny, quantity(10, '1'))).toBeUndefined();
    expect(convertQuantity(huge, 'ms')).toBeUndefined();
    expect(compareQuantity(quantity(1, 'ms'), huge)).toBe(-1);
    expect(quantityEquivalent(quantity(1, 'ms'), huge)).toBe(false);
    expect(addQuantity(quantity(1, 'ms'), huge)).toBeUndefined();
    expect(subtractQuantity(quantity(1, 'ms'), huge)).toBeUndefined();
    expect(minimalUnitSystem.convert(maximum, 's', 'ms')).toBeUndefined();
  });
});

// https://hl7.org/fhir/R5/fhirpath.html#quantity
describe('FHIR Quantity mapping', () => {
  it.each([
    ['a', 'year'],
    ['mo', 'month'],
    ['d', 'day'],
    ['h', 'hour'],
    ['min', 'minute'],
    ['s', 'second'],
    ['wk', 'wk'],
    ['ms', 'ms'],
    ['mg', 'mg'],
  ])('maps UCUM %s to %s', (code, unit) => {
    expect(
      fromFhirQuantity({ value: 1.5, code, system: 'http://unitsofmeasure.org', unit: 'ignored' })
        ?.unit,
    ).toBe(unit);
  });

  it('maps zero and preserves lossless Decimal values', () => {
    expect(
      fromFhirQuantity({ value: 0, code: 'mg', system: 'http://unitsofmeasure.org' })?.value.equals(
        Decimal.ZERO,
      ),
    ).toBe(true);
    const value = Decimal.of(12300n, 4);
    expect(fromFhirQuantity({ value, code: 'a', system: 'http://unitsofmeasure.org' })?.value).toBe(
      value,
    );
  });

  it.each([
    null,
    [],
    1,
    {},
    { value: 1, unit: 'mg' },
    { value: 1, code: 'mg', system: 'other' },
    { value: 1, code: '', system: 'http://unitsofmeasure.org' },
    { value: '1', code: 'mg', system: 'http://unitsofmeasure.org' },
    { value: Number.NaN, code: 'mg', system: 'http://unitsofmeasure.org' },
    { value: Number.POSITIVE_INFINITY, code: 'mg', system: 'http://unitsofmeasure.org' },
    { code: 'mg', system: 'http://unitsofmeasure.org' },
  ])('returns empty for unmappable JSON %j', (json) => {
    expect(fromFhirQuantity(json)).toBeUndefined();
  });

  it.each(['value', 'code', 'system'])('does not read inherited %s', (field) => {
    const valid = { value: 1, code: 'mg', system: 'http://unitsofmeasure.org' };
    const json = Object.create(valid);
    for (const key of ['value', 'code', 'system'] as const) {
      if (key !== field) Object.defineProperty(json, key, { value: valid[key] });
    }
    expect(fromFhirQuantity(json)).toBeUndefined();
  });
});

// Native review regressions: https://hl7.org/fhirpath/STU3/en/index.html#quantity-equality
describe('time comparison and explicit conversion boundaries', () => {
  it.each([
    [36525n, 2, 'days', 'a'],
    [304375n, 4, 'days', 'mo'],
    [365n, 0, 'day', 'a'],
    [30n, 0, 'day', 'mo'],
    [8766n, 0, 'hours', 'a'],
    [7305n, 1, 'hours', 'mo'],
  ] as const)(
    'keeps calendar %s at scale %s %s distinct from %s',
    (coefficient, scale, calendar, ucum) => {
      const a = new Quantity(Decimal.of(coefficient, scale), calendar);
      const b = quantity(1, ucum);
      expect(quantityEquals(a, b)).toBeUndefined();
      expect(quantityEquals(b, a)).toBeUndefined();
      expect(compareQuantity(a, b)).toBeUndefined();
      expect(compareQuantity(b, a)).toBeUndefined();
    },
  );

  // https://hl7.org/fhirpath/STU3/en/index.html#time-valued-unit-conversions
  it.each([
    [1n, 0, 'year', 'a', '1'],
    [1n, 0, 'a', 'year', '1'],
    [1825n, 1, 'days', 'a', '0.5'],
    [1n, 0, 'year', 'd', '365'],
    [1n, 0, 'a', 'day', '365.25'],
    [30n, 0, 'days', 'mo', '1'],
    [1n, 0, 'month', 'mo', '1'],
    [1n, 0, 'mo', 'month', '1'],
  ] as const)(
    'explicitly converts %s at scale %s %s to %s',
    (coefficient, scale, source, target, expected) => {
      const converted = convertQuantity(
        new Quantity(Decimal.of(coefficient, scale), source),
        target,
      );
      expect(converted?.unit).toBe(target);
      const value = Decimal.parse(expected);
      expect(value).toBeDefined();
      expect(value !== undefined && converted?.value.equals(value)).toBe(true);
    },
  );

  it('does not round terminating conversions or make equality depend on operand order', () => {
    const coefficient = 10n ** 28n + 1n;
    const milliseconds = new Quantity(Decimal.of(coefficient, 28), 'ms');
    const seconds = new Quantity(Decimal.of(1n, 3), 's');
    const converted = convertQuantity(milliseconds, 's');
    expect(converted?.value.coefficient).toBe(coefficient);
    expect(converted?.value.scale).toBe(31);
    expect(quantityEquals(seconds, milliseconds)).toBe(false);
    expect(quantityEquals(milliseconds, seconds)).toBe(false);
    expect(compareQuantity(seconds, milliseconds)).toBe(-1);
    expect(compareQuantity(milliseconds, seconds)).toBe(1);
    expect(converted !== undefined && quantityEquals(converted, milliseconds)).toBe(true);
    const months = new Quantity(Decimal.of(coefficient * 12n, 28), 'month');
    expect(convertQuantity(months, 'year')?.value.coefficient).toBe(coefficient);
    expect(convertQuantity(months, 'year')?.value.scale).toBe(28);
    const negative = new Quantity(milliseconds.value.negate(), 'ms');
    expect(convertQuantity(negative, 's')?.value.coefficient).toBe(-coefficient);
  });
});

// 3.0.0 clarifications versus legacy fixtures are documented in docs/spec-notes.md.
describe('current time comparison semantics', () => {
  // https://hl7.org/fhirpath/STU3/en/index.html#comparison
  it.each([
    [1, 'year', 2, 'months', 1], // testLessThan29/testGreaterThan29
    [1, 'year', 2, 'days', 1], // testLessOrEqual28
    [6, 'months', 1, 'year', -1], // published 3.0.0 example
  ] as const)('orders %s %s against %s %s after calendar conversion', (a, au, b, bu, order) => {
    expect(compareQuantity(quantity(a, au), quantity(b, bu))).toBe(order);
    expect(compareQuantity(quantity(b, bu), quantity(a, au))).toBe(-order);
  });

  // https://hl7.org/fhirpath/N1/#equivalent ("invalid units will result in false")
  // https://hl7.org/fhirpath/STU3/en/index.html#quantity-equivalence
  it.each([
    ['x', 'year'], // testEquivalent28 (R4), testEquivalent29 (R5)
    ['year', 'kg'], // testEquivalent29 (R4), testEquivalent30 (R5)
    ['x', 'x2'],
  ])('returns false for unsupported/incompatible equivalence %s/%s', (a, b) => {
    expect(quantityEquivalent(quantity(1, a), quantity(1, b))).toBe(false);
    expect(quantityEquivalent(quantity(1, b), quantity(1, a))).toBe(false);
  });

  // https://hl7.org/fhirpath/STU3/en/index.html#quantity-equality
  it('compares recurring time ratios without rounding distinct values to equality', () => {
    const minutes = new Quantity(Decimal.of(1666666666666666666666666667n, 29), 'min');
    const seconds = quantity(1, 's');
    expect(quantityEquals(minutes, seconds)).toBe(false);
    expect(quantityEquals(seconds, minutes)).toBe(false);
    expect(compareQuantity(minutes, seconds)).toBe(1);
    expect(compareQuantity(seconds, minutes)).toBe(-1);
    const wholeMinute = quantity(1, 'min');
    const slightlyMore = new Quantity(Decimal.of(60n * 10n ** 28n + 1n, 28), 's');
    expect(quantityEquals(wholeMinute, slightlyMore)).toBe(false);
    expect(quantityEquals(slightlyMore, wholeMinute)).toBe(false);
    expect(compareQuantity(wholeMinute, slightlyMore)).toBe(-1);
    expect(compareQuantity(slightlyMore, wholeMinute)).toBe(1);
  });
});
