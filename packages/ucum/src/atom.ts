import type { Dimension } from './dimension.ts';
import type { Rational } from './rational.ts';

/**
 * How a special unit (one on a non-ratio scale) converts. `affine` units relate to their proper
 * unit by `proper = (value + offset) × magnitude`; any other special unit is not convertible.
 * @see https://ucum.org/ucum#section-Special-Units-on-non-ratio-Scales
 */
export type SpecialScale =
  | { readonly kind: 'affine'; readonly offset: Rational }
  | { readonly kind: 'unsupported' };

/** A unit atom with its magnitude and dimension in terms of the base units. */
export interface Atom {
  readonly code: string;
  /** Whether a prefix may be combined with the atom (§11). */
  readonly isMetric: boolean;
  /** For a special unit, the magnitude of its corresponding proper unit. */
  readonly magnitude: Rational;
  readonly dimension: Dimension;
  /** Arbitrary units are commensurable with nothing but themselves (§24, §25). */
  readonly arbitrary: boolean;
  readonly special: SpecialScale | undefined;
}

/** The symbol tables an expression is resolved against. */
export interface UnitLookup {
  /** Whether a unit atom with this code is defined. */
  hasAtom(code: string): boolean;
  /** Whether the atom may take a prefix. */
  isMetric(code: string): boolean;
  /** The atom, or `undefined` if it is unknown or its definition cannot be resolved. */
  atom(code: string): Atom | undefined;
  /** The value of a prefix. */
  prefix(code: string): Rational | undefined;
  /** Prefix codes, longest first, so the longest matching prefix wins (§4). */
  readonly prefixCodes: readonly string[];
}
