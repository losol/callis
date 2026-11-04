/**
 * Property-based tests of `Decimal` against `decimal.js`, which is a dev-time oracle only
 * (ADR-0005, T0004). The oracle computes with far more precision than the inputs need, so its
 * results are exact for `+`, `-`, `*`, `div` and `mod`, and exact before the final rounding for `/`.
 */
import { Decimal as DecimalJs } from 'decimal.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal.ts';
import { ln, log } from './math.ts';

/** At least 1,000 runs per property (T0004 acceptance criterion). */
const RUN_OPTIONS = { numRuns: 1000 };

const Oracle = DecimalJs.clone({
  precision: 1000,
  rounding: DecimalJs.ROUND_HALF_UP, // half away from zero, like Callis
  modulo: DecimalJs.ROUND_DOWN, // truncated division: the remainder has the sign of the dividend
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

/** Builds the oracle value from the parts, so it does not depend on `Decimal.toString()`. */
function toOracle(value: Decimal): DecimalJs {
  return new Oracle(`${value.coefficient}e-${value.scale}`);
}

/** Large values with many digits, and small ones that often collide and cancel. */
const decimals: fc.Arbitrary<Decimal> = fc
  .oneof(
    fc.tuple(fc.bigInt({ min: -(10n ** 40n), max: 10n ** 40n }), fc.integer({ min: 0, max: 30 })),
    fc.tuple(fc.bigInt({ min: -1000n, max: 1000n }), fc.integer({ min: 0, max: 4 })),
  )
  .map(([coefficient, scale]) => Decimal.of(coefficient, scale));

const nonZeroDecimals: fc.Arbitrary<Decimal> = decimals.filter((value) => value.sign() !== 0);

/** Pairs that are often numerically equal but written with different scales. */
const closePairs: fc.Arbitrary<[Decimal, Decimal]> = fc.oneof(
  fc.tuple(decimals, decimals),
  fc
    .tuple(decimals, fc.integer({ min: 0, max: 5 }))
    .map(([value, zeros]): [Decimal, Decimal] => [
      value,
      Decimal.of(value.coefficient * 10n ** BigInt(zeros), value.scale + zeros),
    ]),
  fc
    .tuple(decimals, fc.integer({ min: 0, max: 30 }))
    .map(([value, precision]): [Decimal, Decimal] => [value, value.round(precision)]),
);

describe('Decimal against decimal.js', () => {
  it('adds exactly, with the larger scale', () => {
    fc.assert(
      fc.property(decimals, decimals, (a, b) => {
        const expected = toOracle(a).plus(toOracle(b)).toFixed(Math.max(a.scale, b.scale));
        expect(a.add(b).toString()).toBe(expected);
      }),
      RUN_OPTIONS,
    );
  });

  it('subtracts exactly, with the larger scale', () => {
    fc.assert(
      fc.property(decimals, decimals, (a, b) => {
        const expected = toOracle(a).minus(toOracle(b)).toFixed(Math.max(a.scale, b.scale));
        expect(a.subtract(b).toString()).toBe(expected);
      }),
      RUN_OPTIONS,
    );
  });

  it('multiplies exactly, with the sum of the scales', () => {
    fc.assert(
      fc.property(decimals, decimals, (a, b) => {
        const expected = toOracle(a)
          .times(toOracle(b))
          .toFixed(a.scale + b.scale);
        expect(a.multiply(b).toString()).toBe(expected);
      }),
      RUN_OPTIONS,
    );
  });

  it('divides to 28 significant digits, at least 8 after the point, without trailing zeros', () => {
    fc.assert(
      fc.property(decimals, nonZeroDecimals, (a, b) => {
        // Truncate far beyond the target first, so the single half-up rounding below is exact.
        const quotient = toOracle(a).div(toOracle(b)).toSignificantDigits(900, Oracle.ROUND_DOWN);
        const scale = Math.max(8, 27 - quotient.e);
        const expected = quotient.toDecimalPlaces(scale, Oracle.ROUND_HALF_UP).toFixed();
        expect(a.divide(b)?.toString()).toBe(expected);
      }),
      RUN_OPTIONS,
    );
  });

  it('gives empty when dividing by zero', () => {
    fc.assert(
      fc.property(decimals, fc.integer({ min: 0, max: 5 }), (a, scale) => {
        const zero = Decimal.of(0n, scale);
        expect(a.divide(zero)).toBeUndefined();
        expect(a.div(zero)).toBeUndefined();
        expect(a.mod(zero)).toBeUndefined();
      }),
      RUN_OPTIONS,
    );
  });

  it('compares numerically, ignoring the scale', () => {
    fc.assert(
      fc.property(closePairs, ([a, b]) => {
        expect(a.compare(b)).toBe(toOracle(a).cmp(toOracle(b)));
        expect(a.equals(b)).toBe(toOracle(a).eq(toOracle(b)));
      }),
      RUN_OPTIONS,
    );
  });

  it('truncates division with div', () => {
    fc.assert(
      fc.property(decimals, nonZeroDecimals, (a, b) => {
        expect(a.div(b)?.toString()).toBe(toOracle(a).divToInt(toOracle(b)).toFixed(0));
      }),
      RUN_OPTIONS,
    );
  });

  it('takes the remainder of truncated division with mod, with the larger scale', () => {
    fc.assert(
      fc.property(decimals, nonZeroDecimals, (a, b) => {
        const expected = toOracle(a).mod(toOracle(b)).toFixed(Math.max(a.scale, b.scale));
        expect(a.mod(b)?.toString()).toBe(expected);
      }),
      RUN_OPTIONS,
    );
  });

  it('rounds half away from zero without adding digits', () => {
    fc.assert(
      fc.property(decimals, fc.integer({ min: 0, max: 35 }), (a, precision) => {
        const expected = toOracle(a)
          .toDecimalPlaces(precision, Oracle.ROUND_HALF_UP)
          .toFixed(Math.min(precision, a.scale));
        expect(a.round(precision).toString()).toBe(expected);
      }),
      RUN_OPTIONS,
    );
  });

  it('rounds to whole numbers with truncate, floor and ceiling', () => {
    fc.assert(
      fc.property(decimals, (a) => {
        const oracle = toOracle(a);
        expect(a.truncate().toString()).toBe(
          oracle.toDecimalPlaces(0, Oracle.ROUND_DOWN).toFixed(0),
        );
        expect(a.floor().toString()).toBe(oracle.toDecimalPlaces(0, Oracle.ROUND_FLOOR).toFixed(0));
        expect(a.ceiling().toString()).toBe(
          oracle.toDecimalPlaces(0, Oracle.ROUND_CEIL).toFixed(0),
        );
      }),
      RUN_OPTIONS,
    );
  });

  it('compares equivalence at the precision of the less precise operand', () => {
    fc.assert(
      fc.property(closePairs, ([a, b]) => {
        const left = toOracle(a);
        const right = toOracle(b);
        // decimalPlaces() ignores trailing zeros, as the spec requires for equivalence.
        const precision = Math.min(left.decimalPlaces(), right.decimalPlaces());
        const expected = left
          .toDecimalPlaces(precision, Oracle.ROUND_HALF_UP)
          .eq(right.toDecimalPlaces(precision, Oracle.ROUND_HALF_UP));
        expect(a.equivalent(b)).toBe(expected);
      }),
      RUN_OPTIONS,
    );
  });
});

describe('Decimal round trips', () => {
  it('parses its own text back to the same coefficient and scale', () => {
    fc.assert(
      fc.property(decimals, (a) => {
        const parsed = Decimal.parse(a.toString());
        expect(parsed?.coefficient).toBe(a.coefficient);
        expect(parsed?.scale).toBe(a.scale);
      }),
      RUN_OPTIONS,
    );
  });

  it('formats the same value as decimal.js', () => {
    fc.assert(
      fc.property(decimals, (a) => {
        expect(a.toString()).toBe(toOracle(a).toFixed(a.scale));
      }),
      RUN_OPTIONS,
    );
  });

  it('converts every finite number back to the same number', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (value) => {
        expect(Decimal.fromNumber(value)?.toNumber()).toBe(value === 0 ? 0 : value);
      }),
      RUN_OPTIONS,
    );
  });
});

/** Logarithms are irrational, so the oracle computes them to 60 significant digits. */
const LogOracle = DecimalJs.clone({ precision: 60, toExpNeg: -9e15, toExpPos: 9e15 });

/** Positive values across the whole range, and values within 1e-450 to 0.1 of 1. */
const positiveDecimals: fc.Arbitrary<Decimal> = fc.oneof(
  fc
    .tuple(
      fc.bigInt({ min: 1n, max: 10n ** 40n }),
      fc.integer({ min: 0, max: 450 }),
      fc.integer({ min: 0, max: 450 }),
    )
    .map(([coefficient, scale, zeros]) => Decimal.of(coefficient * 10n ** BigInt(zeros), scale)),
  fc
    .tuple(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), fc.integer({ min: 16, max: 450 }))
    .map(([coefficient, scale]) => Decimal.ONE.add(Decimal.of(coefficient, scale))),
);

/**
 * The result is within 2 units of the 15th significant digit of the exact value. Rounding to 15
 * digits alone accounts for half a unit; the rest is the error of `Math.*`.
 */
function expectFifteenDigits(actual: Decimal | undefined, exact: DecimalJs): void {
  expect(actual).toBeDefined();
  if (actual !== undefined) {
    const error = toOracle(actual).minus(exact).abs();
    // exact.e is the exponent of the leading digit, so the 15th digit is worth 10^(e − 14).
    const unit = new Oracle(10).pow(exact.e - 14);
    expect(error.lte(unit.times(2))).toBe(true);
    // Like division, the result has no trailing zeros after the decimal point.
    expect(actual.scale === 0 || actual.coefficient % 10n !== 0n).toBe(true);
  }
}

describe('ln and log against decimal.js', () => {
  it('keep 15 significant digits for ln, near 1 and beyond the number range', () => {
    fc.assert(
      fc.property(positiveDecimals, (value) => {
        expectFifteenDigits(ln(value), LogOracle.ln(toOracle(value)));
      }),
      RUN_OPTIONS,
    );
  });

  it('keep 15 significant digits for log, near 1 and beyond the number range', () => {
    fc.assert(
      fc.property(
        positiveDecimals,
        positiveDecimals.filter((base) => !base.equals(Decimal.ONE)),
        (value, base) => {
          const exact = LogOracle.ln(toOracle(value)).div(LogOracle.ln(toOracle(base)));
          expectFifteenDigits(log(value, base), exact);
        },
      ),
      RUN_OPTIONS,
    );
  });
});
