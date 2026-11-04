/**
 * Three-valued Boolean logic for `and`, `or`, `xor`, `implies` and `not()`.
 *
 * The functions take operands that have already been through singleton evaluation as Booleans,
 * so empty is `undefined`. The compiler always evaluates both operands before calling them:
 * short-circuiting must not change semantics, and an error in the right operand has to surface
 * even when the left one decides the result. `iif()` is the lazy construct.
 *
 * @see https://hl7.org/fhirpath/N1/#boolean-logic
 */

/** A three-valued Boolean: `true`, `false`, or `undefined` for the empty collection. */
export type TruthValue = boolean | undefined;

/**
 * True if both operands are true, false if either is false, otherwise empty.
 *
 * @see https://hl7.org/fhirpath/N1/#and
 */
export function and(left: TruthValue, right: TruthValue): TruthValue {
  if (left === false || right === false) {
    return false;
  }
  return left === true && right === true ? true : undefined;
}

/**
 * True if either operand is true, false if both are false, otherwise empty.
 *
 * @see https://hl7.org/fhirpath/N1/#or
 */
export function or(left: TruthValue, right: TruthValue): TruthValue {
  if (left === true || right === true) {
    return true;
  }
  return left === false && right === false ? false : undefined;
}

/**
 * True if exactly one operand is true, false if both are true or both are false, and empty if
 * either is empty.
 *
 * @see https://hl7.org/fhirpath/N1/#xor
 */
export function xor(left: TruthValue, right: TruthValue): TruthValue {
  if (left === undefined || right === undefined) {
    return undefined;
  }
  return left !== right;
}

/**
 * The right operand if the left is true, and true if the left is false. With an empty left
 * operand it is true if the right is true, and empty otherwise.
 *
 * @see https://hl7.org/fhirpath/N1/#implies
 */
export function implies(left: TruthValue, right: TruthValue): TruthValue {
  if (left === true) {
    return right;
  }
  if (left === false) {
    return true;
  }
  return right === true ? true : undefined;
}

/**
 * False if the operand is true, true if it is false, and empty if it is empty.
 *
 * @see https://hl7.org/fhirpath/N1/#not-boolean
 */
export function not(value: TruthValue): TruthValue {
  return value === undefined ? undefined : !value;
}
