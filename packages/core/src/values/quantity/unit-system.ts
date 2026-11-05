import { Decimal, isWithinDecimalBounds } from '../decimal/decimal.ts';
import {
  CALENDAR_UCUM,
  CALENDAR_UNITS,
  definiteUnit,
  isCalendarUnit,
  normalizeCalendarUnit,
  timeUnitMagnitude,
} from './calendar-units.ts';

/** Validated unit spelling. Implementations may attach private metadata. */
export interface ParsedUnit {
  readonly unit: string;
}

/** Conversion semantics; future modes can be added without positional arguments. */
export interface UnitConversionOptions {
  /** Allows calendar year/month to match their UCUM counterparts. Default false. */
  readonly equivalence?: boolean;
  /** Explicit toQuantity conversion: convert within the source system, then relabel.
   * Takes precedence over equivalence. Default false; equality/ordering never enable this.
   */
  readonly explicit?: boolean;
}

/** A canonical product/quotient and the factor to apply to its numeric value. */
export interface UnitProduct {
  readonly unit: string;
  /** Strictly positive multiplier; zero and negative scales are unsupported. */
  readonly factor: Decimal;
  /** Strictly positive denominator; default Decimal.ONE. Never zero or negative.
   * Scale is factor/divisor. Kernels multiply exact numerators/denominators before one final
   * Decimal division, rather than rounding a recurring factor such as 1/60 first.
   */
  readonly divisor?: Decimal;
}

/**
 * Pure, synchronous unit provider; unknown, incompatible or overflowing results are undefined.
 * `parse` validates units known to the provider, but identical opaque units may still convert.
 * `convert` preserves identity precision and all representable digits on terminating ratios.
 * Calendar year/month remain distinct from
 * definite durations unless equivalence or explicit conversion is requested. Providers must honor
 * that distinction. Explicit conversion stays within the source system before relabeling to the
 * target counterpart; equivalence instead uses the counterparts to compare without relabeling.
 * Algebra's factor/divisor scales the raw numeric product/quotient into the returned unit; this permits
 * canonicalizing scaled units (e.g. cm/m to '1') without losing a factor of 0.01.
 * Scale components must be strictly positive. Kernels return undefined for invalid components.
 * Every intermediate uses bounded Decimal kernels; intermediate overflow also gives undefined.
 * Affine units must be rejected by algebra when a ratio calculation would be invalid.
 * Calendar division is unsupported except division by the dimensionless unit '1'.
 * Consumers must not inspect provider-specific parsed metadata. New capabilities should be
 * optional; a provider implementing these four methods remains valid.
 * @see https://hl7.org/fhirpath/STU3/#quantity
 */
export interface UnitSystem {
  parse(unit: string): ParsedUnit | undefined;
  /** Optional lossless comparison for providers whose conversions can recur.
   * Compare original values without rounding conversion intermediates; undefined means
   * incompatible or unsupported. Implementations may use exact ratios or affine transforms.
   * Providers without this method use the kernels' conversion fallback.
   */
  compare?(a: Decimal, from: string, b: Decimal, to: string): -1 | 0 | 1 | undefined;
  convert(
    value: Decimal,
    from: string,
    to: string,
    options?: UnitConversionOptions,
  ): Decimal | undefined;
  multiply(a: string, b: string): UnitProduct | undefined;
  divide(a: string, b: string): UnitProduct | undefined;
}

// UCUM definite durations; calendar year/month are NOT assigned these factors.
// https://hl7.org/fhirpath/STU3/#time-valued-quantities
const TIME_FACTORS: Readonly<Record<string, bigint>> = Object.freeze({
  ms: 1n,
  s: 1000n,
  min: 60000n,
  h: 3600000n,
  d: 86400000n,
  wk: 604800000n,
  mo: 2629800000n,
  a: 31557600000n,
});

function factor(unit: string): bigint | undefined {
  return Object.hasOwn(TIME_FACTORS, unit) ? TIME_FACTORS[unit] : undefined;
}

function convert(
  value: Decimal,
  from: string,
  to: string,
  options?: UnitConversionOptions,
): Decimal | undefined {
  const source = normalizeCalendarUnit(from);
  const target = normalizeCalendarUnit(to);
  if (source === target) return value;
  if (options?.explicit) {
    const magnitude = timeUnitMagnitude(target);
    if (
      timeUnitMagnitude(source) !== undefined &&
      magnitude !== undefined &&
      isCalendarUnit(source) !== isCalendarUnit(target)
    ) {
      return convert(value, source, isCalendarUnit(source) ? magnitude : CALENDAR_UCUM[magnitude]);
    }
  }
  // Calendar year/month use the specified 12:1 relation before the approximate day factors.
  if (source === 'year' && target === 'month') return scale(value, 12n, 1n);
  if (source === 'month' && target === 'year') return scale(value, 1n, 12n);
  if (
    CALENDAR_UNITS.some((unit) => unit === source) &&
    CALENDAR_UNITS.some((unit) => unit === target)
  ) {
    const numerator = calendarFactor(source);
    const denominator = calendarFactor(target);
    if (numerator === undefined || denominator === undefined) return undefined;
    return scale(value, numerator, denominator);
  }
  const a = definiteUnit(source, options?.equivalence);
  const b = definiteUnit(target, options?.equivalence);
  if (a === undefined || b === undefined) return undefined;
  const numerator = factor(a);
  const denominator = factor(b);
  if (numerator === undefined || denominator === undefined) return undefined;
  // Reduce before multiplying to avoid false overflow on a canceling ratio.
  return scale(value, numerator, denominator);
}

function scale(value: Decimal, numerator: bigint, denominator: bigint): Decimal | undefined {
  if (numerator === denominator) return value;
  const divisor = gcd(numerator, denominator);
  let coefficient = value.coefficient * (numerator / divisor);
  let remaining = denominator / divisor;
  const cancellation = gcd(coefficient < 0n ? -coefficient : coefficient, remaining);
  coefficient /= cancellation;
  remaining /= cancellation;
  let twos = 0;
  let fives = 0;
  let recurring = remaining;
  while (recurring % 2n === 0n) {
    recurring /= 2n;
    twos++;
  }
  while (recurring % 5n === 0n) {
    recurring /= 5n;
    fives++;
  }
  if (recurring === 1n) {
    const places = Math.max(twos, fives);
    coefficient *= 2n ** BigInt(places - twos) * 5n ** BigInt(places - fives);
    const scale = value.scale + places;
    return isWithinDecimalBounds(coefficient, scale) ? Decimal.of(coefficient, scale) : undefined;
  }
  // Only recurring conversions use arithmetic division's 28-significant-digit rounding.
  if (!isWithinDecimalBounds(coefficient, value.scale)) return undefined;
  return Decimal.of(coefficient, value.scale).divide(Decimal.of(remaining));
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

/** Minimal provider: identity, calendar units, and definite UCUM time durations only. */
export const minimalUnitSystem: UnitSystem = Object.freeze({
  parse(unit: string): ParsedUnit | undefined {
    const normalized = normalizeCalendarUnit(unit);
    return normalized === '1' ||
      normalized === 'year' ||
      normalized === 'month' ||
      factor(definiteUnit(normalized) ?? '') !== undefined
      ? { unit: normalized }
      : undefined;
  },
  convert,
  compare: compareExact,
  multiply(a: string, b: string): UnitProduct | undefined {
    if (a === '1') return { unit: normalizeCalendarUnit(b), factor: Decimal.ONE };
    if (b === '1') return { unit: normalizeCalendarUnit(a), factor: Decimal.ONE };
    return undefined;
  },
  divide(a: string, b: string): UnitProduct | undefined {
    if (b === '1') return { unit: normalizeCalendarUnit(a), factor: Decimal.ONE };
    // Calendar units cannot cancel, even when their fixed-duration counterparts could.
    // https://hl7.org/fhirpath/STU3/en/index.html#division
    if (isCalendarUnit(a) || isCalendarUnit(b)) return undefined;
    const source = normalizeCalendarUnit(a);
    const target = normalizeCalendarUnit(b);
    if (source === target) return { unit: '1', factor: Decimal.ONE };
    const numerator = factor(definiteUnit(source) ?? '');
    const denominator = factor(definiteUnit(target) ?? '');
    if (numerator === undefined || denominator === undefined) return undefined;
    const divisor = gcd(numerator, denominator);
    return {
      unit: '1',
      factor: Decimal.of(numerator / divisor),
      divisor: Decimal.of(denominator / divisor),
    };
  },
});

function compareExact(a: Decimal, from: string, b: Decimal, to: string): -1 | 0 | 1 | undefined {
  const source = normalizeCalendarUnit(to);
  const target = normalizeCalendarUnit(from);
  const sourceMagnitude = timeUnitMagnitude(source);
  const targetMagnitude = timeUnitMagnitude(target);
  if (
    isCalendarUnit(source) !== isCalendarUnit(target) &&
    (sourceMagnitude === 'year' ||
      sourceMagnitude === 'month' ||
      targetMagnitude === 'year' ||
      targetMagnitude === 'month')
  )
    return undefined;
  let numerator: bigint | undefined;
  let denominator: bigint | undefined;
  if (source === target) {
    numerator = 1n;
    denominator = 1n;
  } else if (source === 'year' && target === 'month') {
    numerator = 12n;
    denominator = 1n;
  } else if (source === 'month' && target === 'year') {
    numerator = 1n;
    denominator = 12n;
  } else if (isCalendarUnit(source) && isCalendarUnit(target)) {
    numerator = calendarFactor(source);
    denominator = calendarFactor(target);
  } else {
    numerator = factor(definiteUnit(source) ?? '');
    denominator = factor(definiteUnit(target) ?? '');
  }
  if (numerator === undefined || denominator === undefined) return undefined;
  // Cross-products are comparison intermediates, not new Decimal values. Their maximum size
  // is bounded by the two input limits plus the small built-in time factors.
  // https://hl7.org/fhirpath/STU3/en/index.html#quantity-equality
  const scale = Math.max(a.scale, b.scale);
  const left = a.coefficient * denominator * 10n ** BigInt(scale - a.scale);
  const right = b.coefficient * numerator * 10n ** BigInt(scale - b.scale);
  return left < right ? -1 : left > right ? 1 : 0;
}

function calendarFactor(unit: string): bigint | undefined {
  return unit === 'year'
    ? 31536000000n
    : unit === 'month'
      ? 2592000000n
      : factor(definiteUnit(unit) ?? '');
}
