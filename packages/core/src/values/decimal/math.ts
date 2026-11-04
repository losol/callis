/**
 * Decimal kernels for the math functions `sqrt`, `exp`, `ln`, `log` and `power`
 * ([N1 §5.7](https://hl7.org/fhirpath/N1/#math)).
 *
 * `power` with a whole exponent is computed exactly with `BigInt`. Everything else goes through
 * JavaScript numbers and `Math.*`, so the input is rounded to the nearest `number` first and the
 * result is rounded to 15 significant digits, the most a `number` reliably holds. (`ln` and `log`
 * avoid that first rounding near 1, where it would cost most of the precision.) Values beyond the
 * `number` range lose their meaning on the way in.
 *
 * A result that cannot be represented gives `undefined` (empty): `NaN` (`(-1).sqrt()`), infinite
 * results, and results that underflow to zero although the exact value is not zero. FHIRPath
 * 3.0.0 treats overflow and underflow as empty ([§6.6](https://hl7.org/fhirpath/STU3/#math-1)).
 * Where the spec asks for an error instead, such as `log()` of a negative number in 3.0.0, the
 * function layer raises it.
 */
import { Decimal } from './decimal.ts';

/** Significant digits kept from results computed with JavaScript numbers. */
const NUMBER_SIGNIFICANT_DIGITS = 15;

/**
 * Exact powers with more digits than this are treated as overflow (empty). The spec asks for at
 * least 28 digits; this bound keeps `BigInt` work small (well under a millisecond).
 */
const MAX_EXACT_POWER_DIGITS = 10_000;

/** The smallest coefficient with more than `MAX_EXACT_POWER_DIGITS` digits. */
const EXACT_POWER_LIMIT = 10n ** BigInt(MAX_EXACT_POWER_DIGITS);

/**
 * The square root, through `Math.sqrt`, rounded to 15 significant digits: `81.sqrt()` is `9`.
 *
 * @returns the root, or `undefined` (empty) for negative input.
 * @see https://hl7.org/fhirpath/N1/#sqrt-decimal
 */
export function sqrt(value: Decimal): Decimal | undefined {
  return fromNumberResult(Math.sqrt(value.toNumber()), value.sign() === 0);
}

/**
 * e raised to the value, through `Math.exp`, rounded to 15 significant digits.
 *
 * @returns the power, or `undefined` (empty) if it overflows or underflows a `number`.
 * @see https://hl7.org/fhirpath/N1/#exp-decimal
 */
export function exp(value: Decimal): Decimal | undefined {
  return fromNumberResult(Math.exp(value.toNumber()), false);
}

/**
 * The natural logarithm, rounded to 15 significant digits. Near 1 it keeps that precision too:
 * `1.000001.ln()` is `0.000000999999500000333`.
 *
 * @returns the logarithm, or `undefined` (empty) for zero and negative input.
 * @see https://hl7.org/fhirpath/N1/#ln-decimal
 */
export function ln(value: Decimal): Decimal | undefined {
  return fromNumberResult(naturalLogarithm(value), value.equals(Decimal.ONE));
}

/**
 * The logarithm to the given base, rounded to 15 significant digits: `16.log(2)` is `4`.
 *
 * @returns the logarithm, or `undefined` (empty) for non-positive input, a non-positive base, or
 *   base 1.
 * @see https://hl7.org/fhirpath/N1/#logbase-decimal-decimal
 */
export function log(value: Decimal, base: Decimal): Decimal | undefined {
  // Checked separately because ln(0) is -Infinity, and x / -Infinity would wrongly give 0.
  const baseLogarithm = naturalLogarithm(base);
  if (!Number.isFinite(baseLogarithm) || baseLogarithm === 0) {
    return undefined;
  }
  return fromNumberResult(naturalLogarithm(value) / baseLogarithm, value.equals(Decimal.ONE));
}

/** Values closer to 1 than this use `Math.log1p` in {@link naturalLogarithm}. */
const LOG1P_RANGE = Decimal.of(5n, 1);

/**
 * `ln(value)` as a number. Near 1, `Math.log` would first round the value to the nearest number,
 * which loses most of the digits that matter (`1.0000000001` keeps about 6 correct digits). So
 * there the difference `value − 1` is computed exactly and passed to `Math.log1p`.
 */
function naturalLogarithm(value: Decimal): number {
  const difference = value.subtract(Decimal.ONE);
  return difference.abs().compare(LOG1P_RANGE) < 0
    ? Math.log1p(difference.toNumber())
    : Math.log(value.toNumber());
}

/**
 * Raises `base` to `exponent`. The result depends on the exponent:
 *
 * - A whole, non-negative exponent gives the exact result: `2.5.power(2)` is `6.25`, with the
 *   scale multiplied by the exponent, as repeated `*` would give.
 * - A whole, negative exponent gives `1 / base^|exponent|` by Decimal division, so 28 significant
 *   digits: `2.power(-1)` is `0.5` and `3.power(-1)` is `0.3333333333333333333333333333`.
 *   A zero base gives empty, like division by zero.
 * - Any other exponent goes through `Math.pow`, rounded to 15 significant digits.
 *
 * A whole exponent may have a fractional part of zeros (`2.0`).
 *
 * The exact power `|base|^|exponent|` is bounded: its coefficient and its scale may each have at
 * most 10,000 digits, or the result is empty. For a negative exponent the bound applies to that
 * denominator, so `2.power(-40000)` is empty although 28 digits of it would fit. The scale counts
 * too, so `1.0.power(100000)` and `0.0.power(100000)` are empty: their exact scale is 100,000.
 *
 * @returns the power, or `undefined` (empty) if it cannot be represented: a negative base with a
 *   fractional exponent (`(-1).power(0.5)`), a zero base with a negative exponent, or an exact
 *   power beyond the bound above.
 * @see https://hl7.org/fhirpath/N1/#powerexponent-integer-decimal-integer-decimal
 * @see https://hl7.org/fhirpath/STU3/#powerexponent--integer--decimal--decimal
 */
export function power(base: Decimal, exponent: Decimal): Decimal | undefined {
  if (!exponent.isInteger()) {
    // A negative base has no real power for a fractional exponent. Check it on the Decimal: the
    // exponent's nearest number can be whole (2.0000000000000001 becomes 2).
    if (base.sign() < 0) {
      return undefined;
    }
    return fromNumberResult(base.toNumber() ** exponent.toNumber(), base.sign() === 0);
  }
  const count = exponent.truncate().coefficient;
  if (count >= 0n) {
    return exactPower(base, count);
  }
  if (base.sign() === 0) {
    return undefined;
  }
  const denominator = exactPower(base, -count);
  return denominator === undefined ? undefined : Decimal.ONE.divide(denominator);
}

/** `base^count` for `count ≥ 0`, exactly, or `undefined` if the result is too large. */
function exactPower(base: Decimal, count: bigint): Decimal | undefined {
  if (count === 0n) {
    return Decimal.ONE;
  }
  // `times` may be Infinity for an absurd exponent; the size checks below then reject it.
  const times = Number(count);
  const magnitude = base.coefficient < 0n ? -base.coefficient : base.coefficient;
  const scale = base.scale === 0 ? 0 : base.scale * times;
  // A cheap preflight on log10 of the result, so a huge power is never computed. A result just
  // above the limit can pass it (log10 is one less than the digit count), so the exact check
  // below decides.
  const estimatedLog10 = magnitude <= 1n ? 0 : times * log10(magnitude);
  if (estimatedLog10 > MAX_EXACT_POWER_DIGITS || scale > MAX_EXACT_POWER_DIGITS) {
    return undefined;
  }
  if (magnitude <= 1n) {
    // 0, 1 and -1 stay the same size whatever the exponent, so skip the BigInt power.
    const negative = base.coefficient < 0n && count % 2n === 1n;
    return Decimal.of(negative ? -magnitude : magnitude, scale);
  }
  const coefficient = base.coefficient ** count;
  if (coefficient >= EXACT_POWER_LIMIT || -coefficient >= EXACT_POWER_LIMIT) {
    return undefined;
  }
  return Decimal.of(coefficient, scale);
}

/** An estimate of `log10(value)` for a positive `value` of any size. */
function log10(value: bigint): number {
  const text = value.toString();
  const head = text.slice(0, NUMBER_SIGNIFICANT_DIGITS);
  return Math.log10(Number(head)) + text.length - head.length;
}

/**
 * Converts a result from `Math.*` to a Decimal with at most 15 significant digits, removing
 * trailing zeros.
 *
 * @param zeroIsExact - whether a zero result can be the exact answer. If not, zero means the
 *   result underflowed.
 */
function fromNumberResult(result: number, zeroIsExact: boolean): Decimal | undefined {
  if (!Number.isFinite(result) || (result === 0 && !zeroIsExact)) {
    return undefined;
  }
  // A decimal with at most 15 significant digits survives the trip through a number unchanged,
  // and the shortest round-trip string drops the trailing zeros that toPrecision() adds.
  return Decimal.fromNumber(Number(result.toPrecision(NUMBER_SIGNIFICANT_DIGITS)));
}
