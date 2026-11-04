/**
 * Equality, equivalence and ordering kernels for the System types that are JavaScript primitives:
 * String (`string`), Integer (`number`) and Boolean (`boolean`).
 *
 * The kernels take two values of the same type; dispatch over types, implicit conversions and
 * empty operands belong to the runtime (T0009).
 *
 * @see https://hl7.org/fhirpath/N1/#equals
 * @see https://hl7.org/fhirpath/N1/#equivalent
 * @see https://hl7.org/fhirpath/N1/#comparison
 */

/** The result of an ordering comparison: negative, zero or positive as in `Array.prototype.sort`. */
export type Ordering = -1 | 0 | 1;

/** Every character in the Unicode `White_Space` property, which includes FHIRPath's whitespace. */
const WHITE_SPACE = /\p{White_Space}/gu;

/**
 * Normalizes a string for equivalence (`~`), so that two strings are equivalent exactly when
 * their normalized forms are identical
 * ([string equivalence](https://hl7.org/fhirpath/N1/#string-equivalence)):
 *
 * - Every whitespace character (the Unicode `White_Space` property, as FHIRPath 3.0.0 clarifies)
 *   becomes a space. Runs of whitespace are not collapsed and the ends are not trimmed, so
 *   `'a  b' ~ 'a b'` is false.
 * - Case is folded without regard to locale: upper case, then lower case. This approximates
 *   Unicode full case folding, so `'Straße' ~ 'STRASSE'` and `'σ' ~ 'ς'` are true.
 * - No Unicode normalization (NFC/NFD) is applied; the spec does not ask for it.
 *
 * See `docs/spec-notes.md` for the reasoning.
 */
export function normalizeStringForEquivalence(value: string): string {
  return value.replace(WHITE_SPACE, ' ').toUpperCase().toLowerCase();
}

/**
 * String equality (`=`): exact and case-sensitive, comparing code units.
 *
 * @see https://hl7.org/fhirpath/N1/#equals
 */
export function stringEquals(left: string, right: string): boolean {
  return left === right;
}

/**
 * String equivalence (`~`): equal after {@link normalizeStringForEquivalence}, so case and the
 * kind of whitespace do not matter.
 *
 * @see https://hl7.org/fhirpath/N1/#string-equivalence
 */
export function stringEquivalent(left: string, right: string): boolean {
  return (
    left === right || normalizeStringForEquivalence(left) === normalizeStringForEquivalence(right)
  );
}

/**
 * Orders strings by the Unicode code points of their characters
 * ([N1 §6.2](https://hl7.org/fhirpath/N1/#comparison)). A prefix sorts before the longer
 * string.
 *
 * JavaScript's `<` compares UTF-16 code units instead, which puts characters above U+FFFF
 * (stored as surrogate pairs) before U+E000–U+FFFF. This function corrects for that.
 */
export function compareStrings(left: string, right: string): Ordering {
  if (left === right) {
    return 0;
  }
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const a = left.charCodeAt(index);
    const b = right.charCodeAt(index);
    if (a !== b) {
      return codePointOrder(a) < codePointOrder(b) ? -1 : 1;
    }
  }
  return left.length < right.length ? -1 : 1;
}

/**
 * Maps a UTF-16 code unit to a key that orders like the code point it starts: surrogates
 * (U+D800–U+DFFF, the start of a character above U+FFFF) move above U+E000–U+FFFF.
 */
function codePointOrder(unit: number): number {
  if (unit < 0xd800) {
    return unit;
  }
  return unit < 0xe000 ? unit + 0x2000 : unit - 0x800;
}

/**
 * Integer equality (`=`).
 *
 * @see https://hl7.org/fhirpath/N1/#equals
 */
export function integerEquals(left: number, right: number): boolean {
  return left === right;
}

/**
 * Integer equivalence (`~`). For two Integers it is the same as equality; Integer against
 * Decimal is compared as Decimal by the runtime.
 *
 * @see https://hl7.org/fhirpath/N1/#equivalent
 */
export function integerEquivalent(left: number, right: number): boolean {
  return left === right;
}

/**
 * Orders Integers by value.
 *
 * @see https://hl7.org/fhirpath/N1/#comparison
 */
export function compareIntegers(left: number, right: number): Ordering {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * Boolean equality (`=`).
 *
 * Booleans have equality and equivalence but no ordering: the comparison operators are not
 * defined for Boolean ([N1 §6.2](https://hl7.org/fhirpath/N1/#comparison)).
 *
 * @see https://hl7.org/fhirpath/N1/#equals
 */
export function booleanEquals(left: boolean, right: boolean): boolean {
  return left === right;
}

/**
 * Boolean equivalence (`~`), the same as equality.
 *
 * @see https://hl7.org/fhirpath/N1/#equivalent
 */
export function booleanEquivalent(left: boolean, right: boolean): boolean {
  return left === right;
}
