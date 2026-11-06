import fc from 'fast-check';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { literal } from '../../test/support/literals.ts';
import { stubUnitSystem } from '../../test/support/stub-unit-system.ts';
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { ModelNode } from '../model/model-node.ts';
import { compareTemporal } from '../values/datetime/compare.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { compareQuantity } from '../values/quantity/operations.ts';
import { minimalUnitSystem } from '../values/quantity/unit-system.ts';
import { compareIntegers, compareStrings } from '../values/string.ts';
import type { Item } from './collection.ts';
import { type ComparisonContext, compare, type Ordering } from './comparison.ts';

const ctx: ComparisonContext = { model: undefined, units: minimalUnitSystem, timezoneOffset: 0 };

function node(value: unknown): ModelNode {
  return new ModelNode({ value, name: 'element' });
}

/** The order with the operands swapped, without producing `-0`. */
function negate(order: Ordering | undefined): Ordering | undefined {
  return order === undefined || order === 0 ? order : order === 1 ? -1 : 1;
}

function expectTypeMismatch(run: () => unknown): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(FhirPathEvaluationError);
  expect(caught).toMatchObject({ code: 'eval/type-mismatch' });
}

// https://hl7.org/fhirpath/N1/#comparison
describe('compare', () => {
  it.each<[string, string, Ordering | undefined]>([
    ['1', '2', -1], // testLessThan1
    ['2', '1', 1], // testLessThan15
    ['1', '1', 0], // testLessThan8
    ['1.0', '1.2', -1], // testLessThan2
    ['1.1', '1.0', 1], // testLessThan16
    ['1.0', '1.00', 0], // trailing zeros do not count
    ["'a'", "'b'", -1], // testLessThan3
    ["'A'", "'a'", -1], // testLessThan4
    ["'abc'", "'ABC'", 1], // N1 §6.2.1 example
    ["'a'", "'a'", 0], // testLessThan10
    ["'ab'", "'abc'", -1], // a prefix comes first
    ['@2014-12-12', '@2014-12-13', -1], // testLessThan5
    ['@2014-12-13', '@2014-12-12', 1], // testLessThan19
    ['@2014-12-12', '@2014-12-12', 0], // testLessThan12
    ['@2014-12-13T12:00:00', '@2014-12-13T12:00:01', -1], // testLessThan6
    ['@2014-12-13T12:00:00', '@2014-12-13T12:00:00', 0], // testLessThan13
    ['@T12:00:00', '@T14:00:00', -1], // testLessThan7
    ['@T12:00:01', '@T12:00:00', 1], // testLessThan21
    ['@T12:00:00', '@T12:00:00', 0], // testLessThan14
    ['@2018-03-01T10:30:00', '@2018-03-01T10:30:00.0', 0], // testLessThan26
    ['@T10:30:00', '@T10:30:00.0', 0], // testLessThan27
    ['@2015-02-04T10:00+02:00', '@2015-02-04T09:00+01:00', 0], // offsets are respected
  ])('orders %s and %s as %s', (a, b, expected) => {
    expect(compare(literal(a), literal(b), ctx)).toBe(expected);
  });

  // https://hl7.org/fhirpath/N1/#comparison: "If one value is specified to a different level of
  // precision than the other, the result is empty"
  it.each([
    ['@2018-03', '@2018-03-01'], // testLessThan23
    ['@2018-03-01T10:30', '@2018-03-01T10:30:00'], // testLessThan24
    ['@T10:30', '@T10:30:00'], // testLessThan25
    ['@2012', '@2012-01'],
  ])('returns empty for %s and %s, which have different precisions', (a, b) => {
    expect(compare(literal(a), literal(b), ctx)).toBeUndefined();
    expect(compare(literal(b), literal(a), ctx)).toBeUndefined();
  });

  describe('implicit conversions', () => {
    // https://hl7.org/fhirpath/N1/#comparison: "the integer will be converted to a decimal"
    it.each<[string, string, Ordering]>([
      ['10', '5.0', 1], // N1 §6.2.1 example
      ['1', '1.0', 0],
      ['1', '1.5', -1],
      ['2', '1.99999999', 1],
    ])('converts Integer %s to Decimal against %s', (a, b, expected) => {
      expect(compare(literal(a), literal(b), ctx)).toBe(expected);
      expect(compare(literal(b), literal(a), ctx)).toBe(negate(expected));
    });

    // Date → DateTime: https://hl7.org/fhirpath/N1/#conversion
    it.each<[string, string, Ordering | undefined]>([
      ['@2012-04-15', '@2012-04-16T10:00:00', -1],
      ['@2012-04-16', '@2012-04-15T10:00:00', 1],
      ['@2012-04-15', '@2012-04-15T', 0],
      ['@2012-04-15', '@2012-04-15T10:00:00', undefined],
    ])('converts Date %s to DateTime against %s', (a, b, expected) => {
      expect(compare(literal(a), literal(b), ctx)).toBe(expected);
      expect(compare(literal(b), literal(a), ctx)).toBe(negate(expected));
    });

    // https://hl7.org/fhirpath/STU3/#conversion: Integer and Decimal convert to Quantity with unit '1'
    it.each<[string, string, Ordering | undefined]>([
      ['23', "24 '1'", -1],
      ['23', "23 '1'", 0],
      ['2.5', "2 '1'", 1],
      ['1', "1 'mg'", undefined], // '1' and 'mg' cannot be related
    ])('converts %s to a Quantity against %s', (a, b, expected) => {
      expect(compare(literal(a), literal(b), ctx)).toBe(expected);
      expect(compare(literal(b), literal(a), ctx)).toBe(negate(expected));
    });
  });

  describe('quantities', () => {
    // https://hl7.org/fhirpath/N1/#comparison and the 3.0.0 time-valued quantity table
    it.each<[string, string, Ordering | undefined]>([
      ['10 seconds', "1 's'", 1], // N1 §6.2 example
      ['1 year', "1 'a'", undefined], // testGreaterThan28
      ['1 year', '2 months', 1], // spec notes: ordering calendar years and months
      ["1 'kg'", "2 'm'", undefined], // testLessThan30
      ["1 'mg'", "2 'mg'", -1],
    ])('orders %s and %s as %s', (a, b, expected) => {
      expect(compare(literal(a), literal(b), ctx)).toBe(expected);
    });

    it('uses the unit system of the evaluation', () => {
      const a = literal("150 'cm'");
      const b = literal("1 'm'");
      expect(compare(a, b, ctx)).toBeUndefined();
      expect(compare(a, b, { ...ctx, units: stubUnitSystem })).toBe(1);
    });
  });

  // https://github.com/losol/callis/blob/main/docs/adr/0012-evaluation-defaults.md
  it('reads values without an offset at the timezone offset of the evaluation', () => {
    const utcNoon = literal('@2012-04-15T12:00:00Z');
    const localTen = literal('@2012-04-15T10:00:00');
    expect(compare(utcNoon, localTen, ctx)).toBe(1);
    // 10:00 at -03:00 is 13:00 UTC.
    expect(compare(utcNoon, localTen, { ...ctx, timezoneOffset: -180 })).toBe(-1);
  });

  describe('input nodes', () => {
    it.each<[unknown, Item, Ordering]>([
      [5, 6, -1],
      [1.5, 1, 1],
      [2147483648, 2147483647, 1], // beyond the Integer range: a Decimal
      ['b', 'a', 1],
    ])('compares the System value of a node holding %s with %s', (json, item, expected) => {
      expect(compare(node(json), item, ctx)).toBe(expected);
      expect(compare(item, node(json), ctx)).toBe(negate(expected));
    });

    it('returns empty for a primitive that has only extensions', () => {
      const extensionOnly = new ModelNode({
        value: undefined,
        name: 'birthDate',
        primitiveElement: { extension: [] },
      });
      expect(compare(extensionOnly, literal('@2012'), ctx)).toBeUndefined();
      expect(compare(literal("'a'"), extensionOnly, ctx)).toBeUndefined();
    });
  });

  // https://hl7.org/fhirpath/N1/#comparison: "the evaluator will throw an error if the types differ"
  describe('types that cannot be ordered', () => {
    it.each([
      ['1.5', "'test'"], // testLiteralDecimalLessThanInvalid
      ['1', "'1'"],
      ["'2012'", '@2012'], // a String literal is never read as a date
      ['true', 'false'], // Boolean has no order
      ['true', '1'],
      ['@T10:00', '@2012-01-01T10:00'], // Time against DateTime
      ['@2012', '@T10'], // Date against Time
      ["1 'mg'", "'mg'"],
      ['@2012', "1 'a'"],
    ])('raises eval/type-mismatch for %s and %s', (a, b) => {
      expectTypeMismatch(() => compare(literal(a), literal(b), ctx));
      expectTypeMismatch(() => compare(literal(b), literal(a), ctx));
    });

    it('raises eval/type-mismatch for complex values', () => {
      const complex = node({ family: 'Chalmers' });
      expectTypeMismatch(() => compare(complex, complex, ctx));
      expectTypeMismatch(() => compare(complex, 'Chalmers', ctx));
      expectTypeMismatch(() => compare(1, complex, ctx));
    });
  });

  // Long is phase 2 (T0028); until then, Longs only compare with Longs.
  it('orders two Longs by value', () => {
    expect(compare(1n, 2n, ctx)).toBe(-1);
    expect(compare(2n, 1n, ctx)).toBe(1);
    expect(compare(2n ** 40n, 2n ** 40n, ctx)).toBe(0);
    expectTypeMismatch(() => compare(1n, '1', ctx));
  });

  // https://github.com/losol/callis/issues/57
  it('shares the Ordering type with the ordering results of the value modules', () => {
    expectTypeOf(compare).returns.toEqualTypeOf<Ordering | undefined>();
    expectTypeOf(compareStrings).returns.toExtend<Ordering | undefined>();
    expectTypeOf(compareIntegers).returns.toExtend<Ordering | undefined>();
    expectTypeOf<ReturnType<Decimal['compare']>>().toExtend<Ordering | undefined>();
    expectTypeOf(compareTemporal).returns.toExtend<Ordering | undefined>();
    expectTypeOf(compareQuantity).returns.toExtend<Ordering | undefined>();
  });

  describe('laws', () => {
    const options = { numRuns: 300 };
    const integers = fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 });
    const decimals = fc
      .tuple(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), fc.integer({ min: 0, max: 6 }))
      .map(([coefficient, scale]) => Decimal.of(coefficient, scale));
    const numbers = fc.oneof(integers, decimals);
    const strings = fc.string({ unit: 'binary', maxLength: 6 });

    it('is antisymmetric for numbers and strings', () => {
      for (const values of [numbers, strings]) {
        fc.assert(
          fc.property(values, values, (a, b) => {
            const forward = compare(a, b, ctx);
            expect(forward).toBeDefined();
            expect(compare(b, a, ctx)).toBe(negate(forward));
          }),
          options,
        );
      }
    });

    it('orders mixed Integers and Decimals by value', () => {
      fc.assert(
        fc.property(integers, decimals, (integer, value) => {
          expect(compare(integer, value, ctx)).toBe(Decimal.fromInteger(integer).compare(value));
        }),
        options,
      );
    });
  });
});
