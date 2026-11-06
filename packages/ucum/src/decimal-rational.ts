import { Decimal, MAX_DECIMAL_DIGITS } from '@callis/core';
import { type Rational, rational } from './rational.ts';

const COEFFICIENT_LIMIT = 10n ** BigInt(MAX_DECIMAL_DIGITS);

/** Whether `coefficient × 10^-scale` is within the Decimal size bound. */
function fits(coefficient: bigint, scale: number): boolean {
  return (
    scale <= MAX_DECIMAL_DIGITS &&
    coefficient < COEFFICIENT_LIMIT &&
    -coefficient < COEFFICIENT_LIMIT
  );
}

/** The exact value of a Decimal as a rational. */
export function decimalToRational(value: Decimal): Rational | undefined {
  return rational(value.coefficient, 10n ** BigInt(value.scale));
}

/**
 * Converts an exact result to a Decimal, as the minimal unit system does. A terminating result
 * keeps every digit and at least `minScale` digits after the point, so `1.0 'm'` becomes
 * `100.0 'cm'`; redundant zeros are only dropped when the value would not fit otherwise. A
 * recurring result is rounded once, by Decimal division (28 significant digits).
 *
 * @returns the Decimal, or `undefined` if it is outside the Decimal size bound.
 * @see https://hl7.org/fhirpath/STU3/en/index.html#unit-conversions
 */
export function rationalToDecimal(value: Rational, minScale: number): Decimal | undefined {
  let rest = value.denominator;
  let twos = 0;
  let fives = 0;
  while (rest % 2n === 0n) {
    rest /= 2n;
    twos++;
  }
  while (rest % 5n === 0n) {
    rest /= 5n;
    fives++;
  }
  const places = Math.max(twos, fives);
  if (places > MAX_DECIMAL_DIGITS) return undefined;
  let coefficient = value.numerator * 2n ** BigInt(places - twos) * 5n ** BigInt(places - fives);
  if (rest !== 1n) {
    return fits(coefficient, places) && fits(rest, 0)
      ? Decimal.of(coefficient, places).divide(Decimal.of(rest))
      : undefined;
  }
  let scale = places;
  if (scale < minScale) {
    coefficient *= 10n ** BigInt(minScale - scale);
    scale = minScale;
  }
  while (!fits(coefficient, scale) && scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale--;
  }
  return fits(coefficient, scale) ? Decimal.of(coefficient, scale) : undefined;
}

/**
 * A strictly positive scale as `factor` and optional `divisor` Decimals: a terminating scale is a
 * single exact factor, and a recurring one such as 1/60 keeps both integers so that callers can
 * divide once at the end.
 */
export function rationalToScale(
  value: Rational,
): { readonly factor: Decimal; readonly divisor?: Decimal } | undefined {
  if (value.numerator <= 0n) return undefined;
  const exact = isTerminating(value.denominator) ? rationalToDecimal(value, 0) : undefined;
  if (exact !== undefined) return { factor: exact };
  return fits(value.numerator, 0) && fits(value.denominator, 0)
    ? { factor: Decimal.of(value.numerator), divisor: Decimal.of(value.denominator) }
    : undefined;
}

function isTerminating(denominator: bigint): boolean {
  let rest = denominator;
  while (rest % 2n === 0n) rest /= 2n;
  while (rest % 5n === 0n) rest /= 5n;
  return rest === 1n;
}
