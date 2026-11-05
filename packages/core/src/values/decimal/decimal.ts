import { FhirPathEvaluationError } from '../../errors/fhirpath-error.ts';

/** The System.Integer range, 32-bit ([N1 §4.1.3](https://hl7.org/fhirpath/N1/#integer)). */
const INTEGER_MIN = -2147483648n;
const INTEGER_MAX = 2147483647n;

/**
 * A quotient keeps 28 significant digits, but never fewer than 8 digits after the decimal point
 * ([N1 §4.1.4](https://hl7.org/fhirpath/N1/#decimal): "at least 28 digits with 8 decimal places").
 */
const DIVISION_SIGNIFICANT_DIGITS = 28;
const DIVISION_MIN_SCALE = 8;

/** Decimal text as `toDecimal()` accepts it: `(\+|-)?\d+(\.\d+)?`. Literals are a subset. */
const DECIMAL_TEXT = /^([+-]?)([0-9]+)(?:\.([0-9]+))?$/;

/** What `String(number)` and `Number.prototype.toPrecision` produce for finite numbers. */
const NUMBER_TEXT = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:e([+-][0-9]+))?$/;

/**
 * The size bound of a Decimal: its coefficient has at most this many digits, and its scale is at
 * most this. So every Decimal is below 10^10000 in magnitude, with steps of 10^-10000.
 *
 * N1 asks for at least 28 digits with 8 decimal places and allows more
 * ([N1 §4.1.4](https://hl7.org/fhirpath/N1/#decimal)). The bound keeps `BigInt` work small: without
 * it, repeated multiplication doubles the digits each time until the runtime gives up. A result
 * outside the bound is overflow or underflow, which is empty
 * ([3.0.0 §6.6](https://hl7.org/fhirpath/STU3/#math-1)).
 */
export const MAX_DECIMAL_DIGITS = 10_000;

/** The smallest coefficient magnitude with more than `MAX_DECIMAL_DIGITS` digits. */
const COEFFICIENT_LIMIT = 10n ** BigInt(MAX_DECIMAL_DIGITS);

/**
 * Whether `coefficient × 10^-scale` is within the {@link MAX_DECIMAL_DIGITS} bound, for a
 * non-negative integer `scale`.
 */
export function isWithinDecimalBounds(coefficient: bigint, scale: number): boolean {
  return (
    scale <= MAX_DECIMAL_DIGITS &&
    coefficient < COEFFICIENT_LIMIT &&
    -coefficient < COEFFICIENT_LIMIT
  );
}

/**
 * An exact decimal number that keeps its precision: `value = coefficient × 10^-scale`.
 *
 * The scale is the number of digits after the decimal point and is never negative. It is part of
 * the value's visible precision, so `1.0` (coefficient `10n`, scale 1) and `1` (coefficient `1n`,
 * scale 0) are different instances that are equal (`equals`) but print differently.
 *
 * Instances are immutable; every operation returns a new instance. Operations whose result is
 * empty in FHIRPath, such as division by zero, return `undefined`. So do operations whose exact
 * result would leave the {@link MAX_DECIMAL_DIGITS} bound (overflow and underflow). The design is
 * recorded in ADR-0005 (`docs/adr/0005-bigint-decimal.md`).
 *
 * @see https://hl7.org/fhirpath/N1/#decimal
 */
export class Decimal {
  /** `0`, with scale 0. */
  static readonly ZERO: Decimal = new Decimal(0n, 0);
  /** `1`, with scale 0. */
  static readonly ONE: Decimal = new Decimal(1n, 0);

  /** The unscaled digits, with the sign. */
  readonly coefficient: bigint;
  /** The number of digits after the decimal point, ≥ 0. */
  readonly scale: number;

  private constructor(coefficient: bigint, scale: number) {
    this.coefficient = coefficient;
    this.scale = scale;
  }

  /**
   * Creates `coefficient × 10^-scale`.
   *
   * @throws FhirPathEvaluationError `eval/invalid-argument` if `scale` is not a non-negative integer,
   *   or if the value is outside the {@link MAX_DECIMAL_DIGITS} bound.
   * @example `Decimal.of(254n, 2).toString()` is `'2.54'`.
   */
  static of(coefficient: bigint, scale = 0): Decimal {
    if (!Number.isSafeInteger(scale) || scale < 0) {
      throw invalidArgument('A Decimal scale must be a non-negative integer');
    }
    if (!isWithinDecimalBounds(coefficient, scale)) {
      throw invalidArgument(
        `A Decimal has at most ${MAX_DECIMAL_DIGITS} digits and a scale of at most ${MAX_DECIMAL_DIGITS}`,
      );
    }
    return new Decimal(coefficient, scale);
  }

  /** The value, or `undefined` (overflow or underflow) if it is outside the bound. */
  private static bounded(coefficient: bigint, scale: number): Decimal | undefined {
    return isWithinDecimalBounds(coefficient, scale) ? new Decimal(coefficient, scale) : undefined;
  }

  /**
   * Parses decimal text in the form `(\+|-)?\d+(\.\d+)?`, keeping its scale: `'1.50'` has scale 2.
   * This covers FHIRPath number literals and the strings `toDecimal()` accepts. Exponents,
   * whitespace and other forms are rejected.
   *
   * @returns the value, or `undefined` if the text is not in that form or the value is outside the
   *   {@link MAX_DECIMAL_DIGITS} bound (leading zeros do not count). So a number literal that the
   *   lexer accepts, such as `1` followed by 10,000 zeros, can still give `undefined`.
   * @see https://hl7.org/fhirpath/N1/#todecimal-decimal
   */
  static parse(text: string): Decimal | undefined {
    const match = DECIMAL_TEXT.exec(text);
    if (match === null) {
      return undefined;
    }
    const [, sign = '', integer = '', fraction = ''] = match;
    const allDigits = integer + fraction;
    const firstSignificant = allDigits.search(/[1-9]/);
    const significantDigits = firstSignificant === -1 ? 0 : allDigits.length - firstSignificant;
    // Checked on the text, so an oversized input never becomes a BigInt.
    if (fraction.length > MAX_DECIMAL_DIGITS || significantDigits > MAX_DECIMAL_DIGITS) {
      return undefined;
    }
    const digits = BigInt(allDigits);
    return new Decimal(sign === '-' ? -digits : digits, fraction.length);
  }

  /**
   * Converts a JavaScript number through its shortest round-trip string, so `0.1` becomes `0.1`
   * rather than the exact binary value. The precision of the source text (`1.50` in JSON) is
   * already lost at this point; `-0` becomes `0`.
   *
   * @returns the value, or `undefined` for `NaN` and the infinities.
   */
  static fromNumber(value: number): Decimal | undefined {
    if (!Number.isFinite(value)) {
      return undefined;
    }
    return parseNumberText(String(value));
  }

  /**
   * Converts an Integer to a Decimal with scale 0: the implicit `Integer → Decimal` conversion
   * ([N1 §5.5](https://hl7.org/fhirpath/N1/#conversion)).
   *
   * It does not check the 32-bit Integer range, which Integer values already respect. Any other
   * whole `number` converts exactly to the value it holds (`2 ** 53` gives `9007199254740992`).
   * Long values are `bigint`s; use {@link Decimal.of} for them.
   *
   * @throws FhirPathEvaluationError `eval/invalid-argument` if `value` is not an integer.
   */
  static fromInteger(value: number): Decimal {
    if (!Number.isInteger(value)) {
      throw invalidArgument('Decimal.fromInteger() expects an integer');
    }
    return new Decimal(BigInt(value), 0);
  }

  /** `-1`, `0` or `1`, by the sign of the value. */
  sign(): -1 | 0 | 1 {
    return this.coefficient > 0n ? 1 : this.coefficient < 0n ? -1 : 0;
  }

  /** Whether the value is a whole number, whatever its scale: `2.00` is. */
  isInteger(): boolean {
    return this.scale === 0 || this.coefficient % pow10(this.scale) === 0n;
  }

  /**
   * Formats the value with exactly `scale` digits after the decimal point, so the precision stays
   * visible: `1.0` prints as `'1.0'`. Never uses exponent notation.
   *
   * @see https://hl7.org/fhirpath/N1/#tostring-string
   */
  toString(): string {
    const negative = this.coefficient < 0n;
    const digits = (negative ? -this.coefficient : this.coefficient).toString();
    const sign = negative ? '-' : '';
    if (this.scale === 0) {
      return sign + digits;
    }
    const padded = digits.padStart(this.scale + 1, '0');
    const point = padded.length - this.scale;
    return `${sign}${padded.slice(0, point)}.${padded.slice(point)}`;
  }

  /**
   * The nearest JavaScript number. This can lose precision, and very large or very small values
   * become infinite or zero.
   */
  toNumber(): number {
    return this.scale === 0 ? Number(this.coefficient) : Number(this.toString());
  }

  /**
   * Converts a whole value to an Integer.
   *
   * @returns the value, or `undefined` if it has a fractional part or is outside the 32-bit
   *   Integer range ([N1 §4.1.3](https://hl7.org/fhirpath/N1/#integer)).
   */
  toInteger(): number | undefined {
    if (!this.isInteger()) {
      return undefined;
    }
    const value = this.coefficient / pow10(this.scale);
    return value < INTEGER_MIN || value > INTEGER_MAX ? undefined : Number(value);
  }

  /**
   * Exact sum, with the larger of the two scales: `0.1 + 0.2` is `0.3`.
   *
   * @returns the sum, or `undefined` (empty) if it is outside the {@link MAX_DECIMAL_DIGITS} bound,
   *   for example `1e9999 + 1e-10000`, which needs 20,000 digits.
   * @see https://hl7.org/fhirpath/N1/#addition
   */
  add(other: Decimal): Decimal | undefined {
    const scale = Math.max(this.scale, other.scale);
    return Decimal.bounded(rescale(this, scale) + rescale(other, scale), scale);
  }

  /**
   * Exact difference, with the larger of the two scales.
   *
   * @returns the difference, or `undefined` (empty) if it is outside the
   *   {@link MAX_DECIMAL_DIGITS} bound.
   * @see https://hl7.org/fhirpath/N1/#subtraction
   */
  subtract(other: Decimal): Decimal | undefined {
    const scale = Math.max(this.scale, other.scale);
    return Decimal.bounded(rescale(this, scale) - rescale(other, scale), scale);
  }

  /**
   * Exact product, with the sum of the two scales: `1.2 * 1.8` is `2.16`.
   *
   * @returns the product, or `undefined` (empty) if its coefficient or its scale is outside the
   *   {@link MAX_DECIMAL_DIGITS} bound. The scale counts even for zero: `0` with scale 6,000 times
   *   `0` with scale 6,000 has scale 12,000 and is empty.
   * @see https://hl7.org/fhirpath/N1/#multiplication
   */
  multiply(other: Decimal): Decimal | undefined {
    return Decimal.bounded(this.coefficient * other.coefficient, this.scale + other.scale);
  }

  /**
   * Division. The quotient is rounded half away from zero to 28 significant digits, or to 8 digits
   * after the decimal point if that keeps more, and then trailing zeros are removed: `1 / 2` is
   * `0.5`, `4 / 2` is `2`, and `1 / 3` is `0.3333333333333333333333333333`.
   *
   * @returns the quotient, or `undefined` (empty) when dividing by zero or when the rounded
   *   quotient is outside the {@link MAX_DECIMAL_DIGITS} bound. That happens on the small side
   *   (`1e-9999 / 1e9999` underflows), and also from about `1e9992` up: there the 8 digits after
   *   the point no longer fit next to the integer part, so `1e9995 / 3` is empty unless the
   *   quotient is exact within fewer digits.
   * @see https://hl7.org/fhirpath/N1/#division
   */
  divide(divisor: Decimal): Decimal | undefined {
    if (divisor.coefficient === 0n) {
      return undefined;
    }
    if (this.coefficient === 0n) {
      return Decimal.ZERO;
    }
    // The quotient is (a / b) × 10^(divisor.scale − this.scale), for the coefficients a and b.
    const exponent =
      leadingDigitExponent(abs(this.coefficient), abs(divisor.coefficient)) +
      divisor.scale -
      this.scale;
    // Reject quotients that cannot fit before the large intermediate numbers are built. One whose
    // first digit is at 10^10000 or above has too many integer digits, and rounding cannot make
    // it smaller. One whose first digit is at 10^-10001 can still round up to the smallest step,
    // 10^-10000 ((1 − 1e-29) × 1e-10000 does), so only those below that are rejected here.
    if (exponent >= MAX_DECIMAL_DIGITS || -exponent > MAX_DECIMAL_DIGITS + 1) {
      return undefined;
    }
    const scale = Math.max(DIVISION_MIN_SCALE, DIVISION_SIGNIFICANT_DIGITS - 1 - exponent);
    const shift = scale + divisor.scale - this.scale;
    const rounded =
      shift >= 0
        ? divideRounded(this.coefficient * pow10(shift), divisor.coefficient)
        : divideRounded(this.coefficient, divisor.coefficient * pow10(-shift));
    const stripped = stripTrailingZeros(rounded, scale);
    return Decimal.bounded(stripped.coefficient, stripped.scale);
  }

  /**
   * Truncated division: the quotient without its fractional part, with scale 0.
   * `5.5 div 0.7` is `7` and `-5.5 div 2` is `-2`.
   *
   * @returns the quotient, or `undefined` (empty) when dividing by zero or when the quotient has
   *   more than {@link MAX_DECIMAL_DIGITS} digits.
   * @see https://hl7.org/fhirpath/N1/#div
   */
  div(divisor: Decimal): Decimal | undefined {
    if (divisor.coefficient === 0n) {
      return undefined;
    }
    const scale = Math.max(this.scale, divisor.scale);
    return Decimal.bounded(rescale(this, scale) / rescale(divisor, scale), 0);
  }

  /**
   * The remainder of truncated division, which has the sign of the dividend, with the larger of
   * the two scales. `5.5 mod 0.7` is `0.6` and `-5.5 mod 2` is `-1.5`.
   *
   * @returns the remainder, or `undefined` (empty) when dividing by zero.
   * @see https://hl7.org/fhirpath/N1/#mod
   */
  mod(divisor: Decimal): Decimal | undefined {
    if (divisor.coefficient === 0n) {
      return undefined;
    }
    const scale = Math.max(this.scale, divisor.scale);
    return new Decimal(rescale(this, scale) % rescale(divisor, scale), scale);
  }

  /** The value with the opposite sign and the same scale. */
  negate(): Decimal {
    return new Decimal(-this.coefficient, this.scale);
  }

  /**
   * The absolute value, with the same scale.
   *
   * @see https://hl7.org/fhirpath/N1/#abs-integer-decimal-quantity
   */
  abs(): Decimal {
    return this.coefficient < 0n ? this.negate() : this;
  }

  /**
   * Rounds half away from zero to `precision` digits after the decimal point, as clarified in
   * FHIRPath 3.0.0: `0.5` rounds to `1` and `-0.5` to `-1`. Rounding never adds digits, so a value
   * that already has at most `precision` digits after the point is returned unchanged
   * (`1.5.round(3)` is `1.5`).
   *
   * @param precision - digits to keep after the decimal point; 0 by default.
   * @throws FhirPathEvaluationError `eval/invalid-argument` if `precision` is not a non-negative
   *   integer.
   * @see https://hl7.org/fhirpath/N1/#roundprecision-integer-decimal
   * @see https://hl7.org/fhirpath/STU3/#fn-round
   */
  round(precision = 0): Decimal {
    if (!Number.isSafeInteger(precision) || precision < 0) {
      throw invalidArgument('The precision of round() must be a non-negative integer');
    }
    if (precision >= this.scale) {
      return this;
    }
    return new Decimal(divideRounded(this.coefficient, pow10(this.scale - precision)), precision);
  }

  /**
   * The integer part, towards zero, with scale 0: `-1.56` becomes `-1`.
   *
   * @see https://hl7.org/fhirpath/N1/#truncate-integer
   */
  truncate(): Decimal {
    return this.scale === 0 ? this : new Decimal(this.coefficient / pow10(this.scale), 0);
  }

  /**
   * The greatest whole number less than or equal to the value, with scale 0: `-2.1` becomes `-3`.
   *
   * @see https://hl7.org/fhirpath/N1/#floor-integer
   */
  floor(): Decimal {
    const truncated = this.truncate();
    return this.coefficient < 0n && !this.isInteger()
      ? new Decimal(truncated.coefficient - 1n, 0)
      : truncated;
  }

  /**
   * The least whole number greater than or equal to the value, with scale 0: `1.1` becomes `2`.
   *
   * @see https://hl7.org/fhirpath/N1/#ceiling-integer
   */
  ceiling(): Decimal {
    const truncated = this.truncate();
    return this.coefficient > 0n && !this.isInteger()
      ? new Decimal(truncated.coefficient + 1n, 0)
      : truncated;
  }

  /**
   * Orders two values numerically; the scale does not matter (`1.0` and `1` compare as `0`).
   *
   * @see https://hl7.org/fhirpath/N1/#comparison
   */
  compare(other: Decimal): -1 | 0 | 1 {
    const scale = Math.max(this.scale, other.scale);
    const left = rescale(this, scale);
    const right = rescale(other, scale);
    return left < right ? -1 : left > right ? 1 : 0;
  }

  /**
   * FHIRPath equality: the values are equal, and trailing zeros are ignored (`1.10 = 1.1`).
   *
   * @see https://hl7.org/fhirpath/N1/#equals
   */
  equals(other: Decimal): boolean {
    return this.compare(other) === 0;
  }

  /**
   * FHIRPath equivalence: both values are rounded (half away from zero) to the precision of the
   * less precise one, then compared. Trailing zeros do not count towards the precision, so
   * `1.2 / 1.8 ~ 0.67` and `0.0 ~ 0` are both true.
   *
   * @see https://hl7.org/fhirpath/N1/#equivalent
   */
  equivalent(other: Decimal): boolean {
    const precision = Math.min(significantScale(this), significantScale(other));
    return this.round(precision).equals(other.round(precision));
  }
}

function invalidArgument(message: string): FhirPathEvaluationError {
  return new FhirPathEvaluationError('eval/invalid-argument', message);
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** The coefficient of `value` at a scale that is at least its own. */
function rescale(value: Decimal, scale: number): bigint {
  return scale === value.scale ? value.coefficient : value.coefficient * pow10(scale - value.scale);
}

/** `numerator / denominator`, rounded half away from zero. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (2n * abs(remainder) < abs(denominator)) {
    return quotient;
  }
  return numerator < 0n === denominator < 0n ? quotient + 1n : quotient - 1n;
}

/** `floor(log10(a / b))` for positive `a` and `b`: the position of the quotient's first digit. */
function leadingDigitExponent(a: bigint, b: bigint): number {
  const difference = a.toString().length - b.toString().length;
  // a / b lies between 10^(difference − 1) and 10^(difference + 1).
  const reachesPower = difference >= 0 ? a >= b * pow10(difference) : a * pow10(-difference) >= b;
  return reachesPower ? difference : difference - 1;
}

/** Removes trailing zeros after the decimal point. */
function stripTrailingZeros(
  coefficient: bigint,
  scale: number,
): { coefficient: bigint; scale: number } {
  let digits = coefficient;
  let digitsScale = scale;
  while (digitsScale > 0 && digits % 10n === 0n) {
    digits /= 10n;
    digitsScale -= 1;
  }
  return { coefficient: digits, scale: digitsScale };
}

/** The scale without trailing zeros: the precision that `~` compares at. Zero has precision 0. */
function significantScale(value: Decimal): number {
  return value.coefficient === 0n ? 0 : stripTrailingZeros(value.coefficient, value.scale).scale;
}

/** Parses the output of `String(number)` or `toPrecision()`, which may use exponent notation. */
function parseNumberText(text: string): Decimal | undefined {
  const match = NUMBER_TEXT.exec(text);
  if (match === null) {
    return undefined;
  }
  const [, sign = '', integer = '', fraction = '', exponent = '+0'] = match;
  const digits = BigInt(integer + fraction);
  const coefficient = sign === '-' ? -digits : digits;
  const scale = fraction.length - Number(exponent);
  return scale >= 0 ? Decimal.of(coefficient, scale) : Decimal.of(coefficient * pow10(-scale), 0);
}
