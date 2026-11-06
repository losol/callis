/**
 * A dimension: the exponent of each axis, keyed by base unit code (`m`, `s`, `g`, `rad`, `K`, `C`,
 * `cd`) or by the code of an arbitrary unit, which is its own axis. Zero exponents are omitted, so
 * the dimensionless unit is the empty map.
 * @see https://ucum.org/ucum#section-Semantics
 */
export type Dimension = ReadonlyMap<string, number>;

/** The dimension of the unity `1`. */
export const DIMENSIONLESS: Dimension = new Map();

/** The dimension with one axis at exponent 1. */
export function axis(code: string): Dimension {
  return new Map([[code, 1]]);
}

/**
 * `a × b^exponent`, or `undefined` if an exponent leaves the safe integer range.
 */
export function combineDimensions(a: Dimension, b: Dimension, exponent = 1): Dimension | undefined {
  const result = new Map(a);
  for (const [code, value] of b) {
    const product = value * exponent;
    const sum = (result.get(code) ?? 0) + product;
    if (!Number.isSafeInteger(product) || !Number.isSafeInteger(sum)) return undefined;
    if (sum === 0) result.delete(code);
    else result.set(code, sum);
  }
  return result;
}

/** Whether two dimensions are the same, so that their units are commensurable. */
export function sameDimension(a: Dimension, b: Dimension): boolean {
  if (a.size !== b.size) return false;
  for (const [code, value] of a) {
    if (b.get(code) !== value) return false;
  }
  return true;
}
