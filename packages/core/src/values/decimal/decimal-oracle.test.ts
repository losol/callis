/**
 * Property-based tests of `Decimal` against `decimal.js`, which is a dev-time oracle only
 * (ADR-0005, T0004). The oracle computes with far more precision than the inputs need, so its
 * results are exact for `+`, `-`, `*`, `div` and `mod`, and exact before the final rounding for `/`.
 */
import { Decimal as DecimalJs } from 'decimal.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Decimal, MAX_DECIMAL_DIGITS } from './decimal.ts';
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
        expect(a.add(b)?.toString()).toBe(expected);
      }),
      RUN_OPTIONS,
    );
  });

  it('subtracts exactly, with the larger scale', () => {
    fc.assert(
      fc.property(decimals, decimals, (a, b) => {
        const expected = toOracle(a).minus(toOracle(b)).toFixed(Math.max(a.scale, b.scale));
        expect(a.subtract(b)?.toString()).toBe(expected);
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
        expect(a.multiply(b)?.toString()).toBe(expected);
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
    .map(([coefficient, scale]) => Decimal.of(10n ** BigInt(scale) + coefficient, scale)),
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

/** Exact enough for sums and products of two values at the size bound (20,000 digits). */
const BoundOracle = DecimalJs.clone({ precision: 25_000, toExpNeg: -9e15, toExpPos: 9e15 });

/** Values at and near the size bound, mixed with ordinary ones. */
const nearBoundDecimals: fc.Arbitrary<Decimal> = fc.oneof(
  fc
    .tuple(
      fc.bigInt({ min: -(10n ** 10_000n - 1n), max: 10n ** 10_000n - 1n }),
      fc.integer({ min: 0, max: MAX_DECIMAL_DIGITS }),
    )
    .map(([coefficient, scale]) => Decimal.of(coefficient, scale)),
  fc
    .tuple(fc.bigInt({ min: -(10n ** 40n), max: 10n ** 40n }), fc.integer({ min: 0, max: 30 }))
    .map(([coefficient, scale]) => Decimal.of(coefficient, scale)),
);

/** Factors whose product lands on the bound: about 5,000 digits and a scale of about 5,000. */
const halfBoundFactors: fc.Arbitrary<Decimal> = fc
  .tuple(
    fc.integer({ min: 4_998, max: 5_002 }),
    fc.integer({ min: 4_998, max: 5_002 }),
    fc.boolean(),
  )
  .chain(([digits, scale, negative]) =>
    fc
      .bigInt({ min: 10n ** BigInt(digits - 1), max: 10n ** BigInt(digits) - 1n })
      .map((magnitude) => Decimal.of(negative ? -magnitude : magnitude, scale)),
  );

/** Factors whose product always fits: below 10^5000, with a scale of at most 5,000. */
const fittingFactors: fc.Arbitrary<Decimal> = fc
  .tuple(
    fc.bigInt({ min: -(10n ** 5_000n - 1n), max: 10n ** 5_000n - 1n }),
    fc.integer({ min: 0, max: 5_000 }),
  )
  .map(([coefficient, scale]) => Decimal.of(coefficient, scale));

/** Whether an exact result with the given scale fits the size bound. */
function fitsBound(exact: DecimalJs, scale: number): boolean {
  const coefficient = exact.times(new BoundOracle(10).pow(scale));
  return (
    scale <= MAX_DECIMAL_DIGITS && coefficient.abs().lt(new BoundOracle(10).pow(MAX_DECIMAL_DIGITS))
  );
}

function expectBoundedResult(actual: Decimal | undefined, exact: DecimalJs, scale: number): void {
  if (fitsBound(exact, scale)) {
    expect(actual?.toString()).toBe(exact.toFixed(scale));
  } else {
    expect(actual).toBeUndefined();
  }
}

// These properties work on numbers of about 10,000 digits, and decimal.js is slow at that size: the
// slowest test takes about 5 seconds on a laptop, right at Vitest's default timeout. The longer
// timeout keeps them from failing on a busy machine without lowering the number of runs.
describe('the size bound against decimal.js', { timeout: 30_000 }, () => {
  const options = { numRuns: 100 };
  const toBoundOracle = (value: Decimal): DecimalJs =>
    new BoundOracle(`${value.coefficient}e-${value.scale}`);

  it('gives empty exactly when a sum, difference or product leaves the bound', () => {
    fc.assert(
      fc.property(nearBoundDecimals, nearBoundDecimals, (a, b) => {
        const left = toBoundOracle(a);
        const right = toBoundOracle(b);
        const scale = Math.max(a.scale, b.scale);
        expectBoundedResult(a.add(b), left.plus(right), scale);
        expectBoundedResult(a.subtract(b), left.minus(right), scale);
        expectBoundedResult(a.multiply(b), left.times(right), a.scale + b.scale);
      }),
      options,
    );
  });

  it('multiplies exactly up to the bound, and gives empty exactly beyond it', () => {
    // Factors of about 5,000 digits with a scale of about 5,000 put the product's digits and
    // scale on both sides of 10,000; half-size factors always fit.
    for (const factors of [halfBoundFactors, fittingFactors]) {
      fc.assert(
        fc.property(factors, factors, (a, b) => {
          expectBoundedResult(
            a.multiply(b),
            toBoundOracle(a).times(toBoundOracle(b)),
            a.scale + b.scale,
          );
        }),
        options,
      );
    }
  });

  it('generates products on both sides of the bound', () => {
    const products = fc
      .sample(fc.tuple(halfBoundFactors, halfBoundFactors), { numRuns: 200, seed: 47 })
      .map(([a, b]) => a.multiply(b));
    expect(products.some((product) => product === undefined)).toBe(true);
    expect(products.some((product) => product !== undefined)).toBe(true);
    expect(
      fc
        .sample(fc.tuple(fittingFactors, fittingFactors), { numRuns: 200, seed: 47 })
        .every(([a, b]) => a.multiply(b) !== undefined),
    ).toBe(true);
  });

  it('divides near the bound without throwing, to 28 significant digits when defined', () => {
    fc.assert(
      fc.property(nearBoundDecimals, nearBoundDecimals, (a, b) => {
        for (const result of [a.divide(b), a.div(b), a.mod(b)]) {
          if (result !== undefined) {
            expect(result.scale).toBeLessThanOrEqual(MAX_DECIMAL_DIGITS);
            expect(result.coefficient.toString().replace('-', '').length).toBeLessThanOrEqual(
              MAX_DECIMAL_DIGITS,
            );
          }
        }
        const quotient = a.divide(b);
        if (quotient !== undefined && quotient.sign() !== 0) {
          // Rounded to at least 28 significant digits: |q − a/b| ≤ ½ unit of the 28th digit,
          // so |q × b − a| ≤ |b| × 10^(e − 27), where e is the exponent of q's first digit.
          const q = toBoundOracle(quotient);
          const divisor = toBoundOracle(b);
          const error = q.times(divisor).minus(toBoundOracle(a)).abs();
          expect(error.lte(divisor.abs().times(new BoundOracle(10).pow(q.e - 27)))).toBe(true);
        }
      }),
      options,
    );
  });
});
