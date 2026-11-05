import { Decimal } from '../decimal/decimal.ts';
import { CALENDAR_UNITS, definiteUnit, normalizeCalendarUnit } from './calendar-units.ts';

/** Validated unit spelling. Implementations may attach private metadata. */
export interface ParsedUnit {
  readonly unit: string;
}

/** Conversion semantics; future modes can be added without positional arguments. */
export interface UnitConversionOptions {
  /** Allows calendar year/month to match their UCUM counterparts. Default false. */
  readonly equivalence?: boolean;
}

/** A canonical product/quotient and the factor to apply to its numeric value. */
export interface UnitProduct {
  readonly unit: string;
  readonly factor: Decimal;
}

/**
 * Pure, synchronous unit provider; unknown, incompatible or overflowing results are undefined.
 * `parse` validates units known to the provider, but identical opaque units may still convert.
 * `convert` preserves input precision on identity. Calendar year/month remain distinct from
 * definite durations unless equivalence is requested. Providers must honor that distinction.
 * Algebra's factor scales the raw numeric product/quotient into the returned unit; this permits
 * canonicalizing scaled units (e.g. cm/m to '1') without losing a factor of 0.01.
 * Affine units must be rejected by algebra when a ratio calculation would be invalid.
 * Consumers must not inspect provider-specific parsed metadata. New capabilities should be
 * optional; a provider implementing these four methods remains valid.
 * @see https://hl7.org/fhirpath/STU3/#quantity
 */
export interface UnitSystem {
  parse(unit: string): ParsedUnit | undefined;
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
  // Calendar years and months have a precise relation to each other, not to days.
  if (source === 'year' && target === 'month') return value.multiply(Decimal.of(12n));
  if (source === 'month' && target === 'year') return value.divide(Decimal.of(12n));
  if (
    CALENDAR_UNITS.some((unit) => unit === source) &&
    CALENDAR_UNITS.some((unit) => unit === target)
  ) {
    const calendarFactor = (unit: string): bigint | undefined =>
      unit === 'year'
        ? 31536000000n
        : unit === 'month'
          ? 2592000000n
          : factor(definiteUnit(unit) ?? '');
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
  const divisor = gcd(numerator, denominator);
  const scaled = value.multiply(Decimal.of(numerator / divisor));
  return scaled?.divide(Decimal.of(denominator / divisor));
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
  multiply(a: string, b: string): UnitProduct | undefined {
    if (a === '1') return { unit: normalizeCalendarUnit(b), factor: Decimal.ONE };
    if (b === '1') return { unit: normalizeCalendarUnit(a), factor: Decimal.ONE };
    return undefined;
  },
  divide(a: string, b: string): UnitProduct | undefined {
    if (b === '1') return { unit: normalizeCalendarUnit(a), factor: Decimal.ONE };
    const ratio = convert(Decimal.ONE, a, b);
    return ratio === undefined ? undefined : { unit: '1', factor: ratio };
  },
});
