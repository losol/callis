import type { Atom, SpecialScale, UnitLookup } from './atom.ts';
import { combineDimensions, DIMENSIONLESS, type Dimension } from './dimension.ts';
import { parseUnitExpression, type UnitTermSyntax } from './expression/unit-expression.ts';
import { MAX_MAGNITUDE_BITS, multiply, ONE, power, type Rational } from './rational.ts';

/** A simple unit of an expression with its exponent, kept for unit algebra. */
export interface UnitTerm {
  /** The prefix and atom as written, without exponent or annotation, such as `cm`. */
  readonly symbol: string;
  readonly exponent: number;
  /** The magnitude of the simple unit itself (prefix × atom), before the exponent. */
  readonly magnitude: Rational;
  /** The dimension of the simple unit itself, before the exponent. */
  readonly dimension: Dimension;
  readonly arbitrary: boolean;
}

/** A unit expression resolved to its magnitude and dimension in base units. */
export interface ResolvedUnit {
  readonly magnitude: Rational;
  readonly dimension: Dimension;
  /** Every simple unit with its signed exponent, in written order. */
  readonly terms: readonly UnitTerm[];
  /** The product of the integer numbers in the expression, such as 10 in `10.L`. */
  readonly scalar: Rational;
  /** Whether an arbitrary unit occurs, which makes the whole term arbitrary (§25). */
  readonly arbitrary: boolean;
  /**
   * Set when a special unit occurs. Only a special unit on its own, without prefix or exponent,
   * keeps its scale; any other use is `unsupported` (§22).
   */
  readonly special: SpecialScale | undefined;
}

const UNSUPPORTED: SpecialScale = Object.freeze({ kind: 'unsupported' });

interface Accumulator {
  magnitude: Rational;
  dimension: Dimension;
  scalar: Rational;
  arbitrary: boolean;
  special: boolean;
  readonly terms: UnitTerm[];
}

/**
 * Resolves a case-sensitive UCUM expression such as `mg/dL` or `kg.m/s2` against the symbol
 * tables. Annotations are ignored (§12).
 *
 * @returns the unit, or `undefined` if it is invalid, uses an unknown symbol, has a zero
 *   number, or a magnitude on the way needs more than {@link MAX_MAGNITUDE_BITS} bits.
 * @see https://ucum.org/ucum#section-Semantics
 */
export function resolveUnit(text: string, lookup: UnitLookup): ResolvedUnit | undefined {
  const syntax = parseUnitExpression(text);
  if (syntax === undefined) return undefined;
  const state: Accumulator = {
    magnitude: ONE,
    dimension: DIMENSIONLESS,
    scalar: ONE,
    arbitrary: false,
    special: false,
    terms: [],
  };
  if (!accumulate(syntax, 1, state, lookup)) return undefined;
  if (state.special) return resolveSpecial(syntax, lookup);
  return {
    magnitude: state.magnitude,
    dimension: state.dimension,
    terms: state.terms,
    scalar: state.scalar,
    arbitrary: state.arbitrary,
    special: undefined,
  };
}

function accumulate(
  term: UnitTermSyntax,
  sign: 1 | -1,
  state: Accumulator,
  lookup: UnitLookup,
): boolean {
  for (const { operator, component } of term.factors) {
    const direction = sign === operator ? 1 : -1;
    switch (component.kind) {
      case 'annotation':
        break;
      case 'group':
        if (!accumulate(component.term, direction, state, lookup)) return false;
        break;
      case 'number': {
        const value = power(
          { numerator: component.value, denominator: 1n },
          component.exponent,
          MAX_MAGNITUDE_BITS,
        );
        const scaled = value === undefined ? undefined : power(value, direction);
        if (scaled === undefined || scaled.numerator === 0n) return false;
        const magnitude = multiply(state.magnitude, scaled, MAX_MAGNITUDE_BITS);
        const scalar = multiply(state.scalar, scaled, MAX_MAGNITUDE_BITS);
        if (magnitude === undefined || scalar === undefined) return false;
        state.magnitude = magnitude;
        state.scalar = scalar;
        break;
      }
      case 'symbol': {
        const unit = simpleUnit(component.symbol, lookup);
        if (unit === undefined) return false;
        if (unit.atom.special !== undefined) {
          state.special = true;
          break;
        }
        const exponent = component.exponent * direction;
        const perUnit = multiply(unit.prefix, unit.atom.magnitude, MAX_MAGNITUDE_BITS);
        const scaled =
          perUnit === undefined ? undefined : power(perUnit, exponent, MAX_MAGNITUDE_BITS);
        const magnitude =
          scaled === undefined ? undefined : multiply(state.magnitude, scaled, MAX_MAGNITUDE_BITS);
        const dimension = combineDimensions(state.dimension, unit.atom.dimension, exponent);
        if (perUnit === undefined || magnitude === undefined || dimension === undefined) {
          return false;
        }
        state.magnitude = magnitude;
        state.dimension = dimension;
        state.arbitrary ||= unit.atom.arbitrary;
        state.terms.push({
          symbol: component.symbol,
          exponent,
          magnitude: perUnit,
          dimension: unit.atom.dimension,
          arbitrary: unit.atom.arbitrary,
        });
        break;
      }
      default:
        return assertNever(component);
    }
  }
  return true;
}

/**
 * Special units take no part in algebra (§22■1). Only a lone, unprefixed special unit with
 * exponent 1, such as `Cel` or `Cel{body}`, keeps its scale.
 */
function resolveSpecial(syntax: UnitTermSyntax, lookup: UnitLookup): ResolvedUnit {
  const [only, ...rest] = syntax.factors;
  const component = only?.component;
  const atom =
    rest.length === 0 &&
    only?.operator === 1 &&
    component?.kind === 'symbol' &&
    component.exponent === 1
      ? lookup.atom(component.symbol)
      : undefined;
  if (atom?.special?.kind === 'affine') {
    return {
      magnitude: atom.magnitude,
      dimension: atom.dimension,
      terms: [],
      scalar: ONE,
      arbitrary: false,
      special: atom.special,
    };
  }
  return {
    magnitude: ONE,
    dimension: DIMENSIONLESS,
    terms: [],
    scalar: ONE,
    arbitrary: false,
    special: UNSUPPORTED,
  };
}

/**
 * Splits a simple unit into prefix and atom. The prefix is the longest one whose remainder is a
 * metric atom; without such a prefix the whole symbol must be an atom (§4■4).
 */
function simpleUnit(
  symbol: string,
  lookup: UnitLookup,
): { readonly prefix: Rational; readonly atom: Atom } | undefined {
  for (const code of lookup.prefixCodes) {
    if (symbol.length <= code.length || !symbol.startsWith(code)) continue;
    const rest = symbol.slice(code.length);
    if (!lookup.hasAtom(rest) || !lookup.isMetric(rest)) continue;
    const atom = lookup.atom(rest);
    const prefix = lookup.prefix(code);
    return atom === undefined || prefix === undefined ? undefined : { prefix, atom };
  }
  const atom = lookup.atom(symbol);
  return atom === undefined ? undefined : { prefix: ONE, atom };
}

function assertNever(value: never): never {
  return value;
}
