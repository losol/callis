import {
  Decimal,
  minimalUnitSystem,
  type ParsedUnit,
  type UnitConversionOptions,
  type UnitProduct,
  type UnitSystem,
} from '@callis/core';
import type { UnitLookup } from './atom.ts';
import { decimalToRational, rationalToDecimal, rationalToScale } from './decimal-rational.ts';
import { sameDimension } from './dimension.ts';
import {
  add,
  compare as compareRational,
  divide,
  multiply,
  power,
  type Rational,
  subtract,
} from './rational.ts';
import { type ResolvedUnit, resolveUnit, type UnitTerm } from './resolve-unit.ts';

/**
 * The UCUM counterpart of each calendar keyword. Week to millisecond are equal to theirs; year and
 * month are only equivalent to `a` and `mo`.
 * @see https://hl7.org/fhirpath/STU3/#time-valued-quantities
 */
const CALENDAR_UCUM: Readonly<Record<string, string>> = Object.freeze({
  year: 'a',
  month: 'mo',
  week: 'wk',
  day: 'd',
  hour: 'h',
  minute: 'min',
  second: 's',
  millisecond: 'ms',
});

/**
 * Creates a UCUM unit system from resolved symbol tables.
 *
 * Calendar keywords and the units the minimal unit system knows (`1` and the UCUM time units)
 * are handed to `minimalUnitSystem` whenever both units of an operation are among them, so the
 * calendar rules stay exactly as in core. Other units are resolved as UCUM expressions:
 * commensurable units convert exactly, `Cel` and `[degF]` convert on their offset scales, and
 * arbitrary or other special units only match the identical unit.
 */
export function createUcumUnitSystem(lookup: UnitLookup): UnitSystem {
  const resolve = (unit: string): ResolvedUnit | undefined => resolveUnit(unit, lookup);

  function convertUcum(value: Decimal, from: string, to: string): Decimal | undefined {
    const source = commensurable(resolve(from), resolve(to));
    if (source === undefined) return undefined;
    const exact = decimalToRational(value);
    const base = exact === undefined ? undefined : toBase(exact, source[0]);
    const result = base === undefined ? undefined : fromBase(base, source[1]);
    return result === undefined ? undefined : rationalToDecimal(result, value.scale);
  }

  function compareUcum(a: Decimal, from: string, b: Decimal, to: string): -1 | 0 | 1 | undefined {
    const units = commensurable(resolve(from), resolve(to));
    if (units === undefined) return undefined;
    const left = decimalToRational(a);
    const right = decimalToRational(b);
    const leftBase = left === undefined ? undefined : toBase(left, units[0]);
    const rightBase = right === undefined ? undefined : toBase(right, units[1]);
    return leftBase === undefined || rightBase === undefined
      ? undefined
      : compareRational(leftBase, rightBase);
  }

  function algebra(a: string, b: string, sign: 1 | -1): UnitProduct | undefined {
    const left = resolve(a);
    const right = resolve(b);
    // §22: special units take no part in algebra, not even with a scalar.
    if (left?.special !== undefined || right?.special !== undefined) return undefined;
    // Like the minimal unit system, '1' and identical units keep units that UCUM does not know.
    if (b === '1') return { unit: a, factor: Decimal.ONE };
    if (sign === 1 && a === '1') return { unit: b, factor: Decimal.ONE };
    if (sign === -1 && a === b) return { unit: '1', factor: Decimal.ONE };
    if (left === undefined || right === undefined) return undefined;
    return canonicalProduct(left, right, sign);
  }

  return Object.freeze({
    parse(unit: string): ParsedUnit | undefined {
      return minimalUnitSystem.parse(unit) ?? (resolve(unit) === undefined ? undefined : { unit });
    },
    convert(
      value: Decimal,
      from: string,
      to: string,
      options?: UnitConversionOptions,
    ): Decimal | undefined {
      const source = calendarKeyword(from);
      const target = calendarKeyword(to);
      if ((source ?? from) === (target ?? to)) return value;
      if (isMinimalUnit(from) && isMinimalUnit(to)) {
        return minimalUnitSystem.convert(value, from, to, options);
      }
      // Explicit conversion stays in the source system and relabels to the target's
      // counterpart, so only a calendar target may use its year/month counterpart.
      const explicit = options?.explicit === true;
      const equivalence = !explicit && options?.equivalence === true;
      const a = source === undefined ? from : ucumCounterpart(source, equivalence);
      const b = target === undefined ? to : ucumCounterpart(target, equivalence || explicit);
      return a === undefined || b === undefined ? undefined : convertUcum(value, a, b);
    },
    compare(a: Decimal, from: string, b: Decimal, to: string): -1 | 0 | 1 | undefined {
      const source = calendarKeyword(from);
      const target = calendarKeyword(to);
      if ((source ?? from) === (target ?? to)) return a.compare(b);
      if (isMinimalUnit(from) && isMinimalUnit(to)) {
        return minimalUnitSystem.compare?.(a, from, b, to);
      }
      const x = source === undefined ? from : ucumCounterpart(source, false);
      const y = target === undefined ? to : ucumCounterpart(target, false);
      return x === undefined || y === undefined ? undefined : compareUcum(a, x, b, y);
    },
    multiply(a: string, b: string): UnitProduct | undefined {
      // Calendar units only combine with '1' (3.0.0 multiplication).
      if (calendarKeyword(a) !== undefined || calendarKeyword(b) !== undefined) {
        return minimalUnitSystem.multiply(a, b);
      }
      return algebra(a, b, 1);
    },
    divide(a: string, b: string): UnitProduct | undefined {
      if (calendarKeyword(a) !== undefined || calendarKeyword(b) !== undefined) {
        return minimalUnitSystem.divide(a, b);
      }
      return algebra(a, b, -1);
    },
  });
}

/** Both units if they can be converted into each other, else `undefined`. */
function commensurable(
  a: ResolvedUnit | undefined,
  b: ResolvedUnit | undefined,
): readonly [ResolvedUnit, ResolvedUnit] | undefined {
  if (a === undefined || b === undefined) return undefined;
  if (a.special?.kind === 'unsupported' || b.special?.kind === 'unsupported') return undefined;
  // §25: a term with an arbitrary unit is not comparable with any other term.
  if (a.arbitrary || b.arbitrary) return undefined;
  return sameDimension(a.dimension, b.dimension) ? [a, b] : undefined;
}

/** The value in base units: `(value + offset) × magnitude` for `Cel` and `[degF]`. */
function toBase(value: Rational, unit: ResolvedUnit): Rational | undefined {
  const shifted = unit.special?.kind === 'affine' ? add(value, unit.special.offset) : value;
  return shifted === undefined ? undefined : multiply(shifted, unit.magnitude);
}

function fromBase(base: Rational, unit: ResolvedUnit): Rational | undefined {
  const scaled = divide(base, unit.magnitude);
  if (scaled === undefined || unit.special?.kind !== 'affine') return scaled;
  return subtract(scaled, unit.special.offset);
}

/**
 * The product or quotient of two units in canonical form. Identical simple units add their
 * exponents (`cm2 / cm` is `cm`); a simple unit commensurable with an earlier one is converted
 * into it (`m/s × min` is `m` with factor 60, and `cm / m` is `1` with factor 1/100). Arbitrary
 * and dimensionless units only combine with identical ones. Integer factors and annotations are
 * folded into the scale.
 * @see https://hl7.org/fhirpath/STU3/en/index.html#multiplication
 */
function canonicalProduct(
  left: ResolvedUnit,
  right: ResolvedUnit,
  sign: 1 | -1,
): UnitProduct | undefined {
  let scale = sign === 1 ? multiply(left.scalar, right.scalar) : divide(left.scalar, right.scalar);
  const terms: { term: UnitTerm; exponent: number }[] = [];
  const inputs = [
    ...left.terms.map((term) => ({ term, exponent: term.exponent })),
    ...right.terms.map((term) => ({ term, exponent: term.exponent * sign })),
  ];
  for (const input of inputs) {
    if (scale === undefined) return undefined;
    const same = terms.find((entry) => entry.term.symbol === input.term.symbol);
    const target =
      same ??
      (input.term.arbitrary || input.term.dimension.size === 0
        ? undefined
        : terms.find(
            (entry) =>
              !entry.term.arbitrary && sameDimension(entry.term.dimension, input.term.dimension),
          ));
    if (target === undefined) {
      terms.push({ term: input.term, exponent: input.exponent });
      continue;
    }
    if (target !== same) {
      const ratio = divide(input.term.magnitude, target.term.magnitude);
      const factor = ratio === undefined ? undefined : power(ratio, input.exponent);
      scale = factor === undefined ? undefined : multiply(scale, factor);
    }
    target.exponent += input.exponent;
    if (!Number.isSafeInteger(target.exponent)) return undefined;
  }
  if (scale === undefined) return undefined;
  const parts = rationalToScale(scale);
  if (parts === undefined) return undefined;
  const unit = formatTerms(terms);
  return parts.divisor === undefined
    ? { unit, factor: parts.factor }
    : { unit, factor: parts.factor, divisor: parts.divisor };
}

/** Writes terms as `a.b2/c/d3`, or `/s` without a numerator, or `1` when nothing is left. */
function formatTerms(terms: readonly { term: UnitTerm; exponent: number }[]): string {
  let numerator = '';
  let denominator = '';
  for (const { term, exponent } of terms) {
    if (exponent > 0) {
      numerator += `${numerator === '' ? '' : '.'}${term.symbol}${exponent === 1 ? '' : exponent}`;
    } else if (exponent < 0) {
      denominator += `/${term.symbol}${exponent === -1 ? '' : -exponent}`;
    }
  }
  return numerator === '' && denominator === '' ? '1' : numerator + denominator;
}

/** The singular calendar keyword a unit spells, if any (`weeks` is `week`). */
function calendarKeyword(unit: string): string | undefined {
  const singular = unit.endsWith('s') ? unit.slice(0, -1) : unit;
  if (Object.hasOwn(CALENDAR_UCUM, unit)) return unit;
  return Object.hasOwn(CALENDAR_UCUM, singular) ? singular : undefined;
}

/** The UCUM unit a calendar keyword may be related to; year/month only with equivalence. */
function ucumCounterpart(keyword: string, yearAndMonth: boolean): string | undefined {
  if ((keyword === 'year' || keyword === 'month') && !yearAndMonth) return undefined;
  return Object.hasOwn(CALENDAR_UCUM, keyword) ? CALENDAR_UCUM[keyword] : undefined;
}

/** Units the minimal unit system knows: `1`, calendar keywords and the UCUM time units. */
function isMinimalUnit(unit: string): boolean {
  return minimalUnitSystem.parse(unit) !== undefined;
}
