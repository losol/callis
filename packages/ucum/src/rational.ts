/**
 * An exact fraction `numerator / denominator` in lowest terms, with a positive denominator.
 * Unit magnitudes are kept as rationals, so conversions only round once, at the very end.
 */
export interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/**
 * The largest numerator or denominator, in bits (about 21,000 decimal digits). A Decimal has at
 * most 10,000 digits on either side of the point, so a ratio of 10^20000 or more already maps
 * every non-zero Decimal outside that bound. Larger magnitudes are rejected before `BigInt` work
 * grows with them.
 */
export const MAX_RATIONAL_BITS = 70_000;

/** The rational 1. */
export const ONE: Rational = Object.freeze({ numerator: 1n, denominator: 1n });

/** `numerator / denominator` in lowest terms, or `undefined` for a zero denominator or overflow. */
export function rational(numerator: bigint, denominator = 1n): Rational | undefined {
  if (denominator === 0n) return undefined;
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const divisor = gcd(abs(numerator), denominator);
  if (divisor > 1n) {
    numerator /= divisor;
    denominator /= divisor;
  }
  if (bitLength(numerator) > MAX_RATIONAL_BITS || bitLength(denominator) > MAX_RATIONAL_BITS) {
    return undefined;
  }
  return { numerator, denominator };
}

/** `a × b`, or `undefined` on overflow. */
export function multiply(a: Rational, b: Rational): Rational | undefined {
  return rational(a.numerator * b.numerator, a.denominator * b.denominator);
}

/** `a / b`, or `undefined` when `b` is zero or on overflow. */
export function divide(a: Rational, b: Rational): Rational | undefined {
  return rational(a.numerator * b.denominator, a.denominator * b.numerator);
}

/** `a + b`, or `undefined` on overflow. */
export function add(a: Rational, b: Rational): Rational | undefined {
  return rational(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

/** `a - b`, or `undefined` on overflow. */
export function subtract(a: Rational, b: Rational): Rational | undefined {
  return rational(
    a.numerator * b.denominator - b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

/**
 * `base ^ exponent` for an integer exponent, or `undefined` for `0 ^ -n` and for results beyond
 * {@link MAX_RATIONAL_BITS}. The size is checked before the power is computed.
 */
export function power(base: Rational, exponent: number): Rational | undefined {
  if (!Number.isSafeInteger(exponent)) return undefined;
  if (exponent === 0) return ONE;
  const magnitude = Math.abs(exponent);
  const size = Math.max(bitLength(base.numerator), bitLength(base.denominator));
  // |x|^n needs at most n × bits(x) bits; 1 stays 1 for any n.
  if (size > 1 && (size - 1) * magnitude > MAX_RATIONAL_BITS) return undefined;
  const n = BigInt(magnitude);
  return exponent > 0
    ? rational(base.numerator ** n, base.denominator ** n)
    : rational(base.denominator ** n, base.numerator ** n);
}

/** Orders two rationals exactly. */
export function compare(a: Rational, b: Rational): -1 | 0 | 1 {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  return left < right ? -1 : left > right ? 1 : 0;
}

const DECIMAL_TEXT = /^([+-]?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/;

/**
 * Parses decimal text with an optional exponent, such as `1e-3`, `980665e-5` or `3.14159`, as the
 * exact rational it denotes. This is the number format of the essence file's `value` attributes.
 */
export function parseDecimalText(text: string): Rational | undefined {
  const match = DECIMAL_TEXT.exec(text);
  if (match === null) return undefined;
  const [, sign = '', integer = '', fraction = '', exponentText = '0'] = match;
  const exponent = Number(exponentText) - fraction.length;
  // 10^n has more than 3n bits, so a longer exponent cannot give a magnitude within the bound.
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) * 3 > MAX_RATIONAL_BITS) {
    return undefined;
  }
  const digits = BigInt(integer + fraction) * (sign === '-' ? -1n : 1n);
  const scale = 10n ** BigInt(Math.abs(exponent));
  return exponent >= 0 ? rational(digits * scale) : rational(digits, scale);
}

/** The number of bits in `|value|`. */
function bitLength(value: bigint): number {
  return value === 0n ? 0 : abs(value).toString(2).length;
}

/** The greatest common divisor of two non-negative integers. */
function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}
