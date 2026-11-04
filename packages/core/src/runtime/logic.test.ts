import { describe, expect, it } from 'vitest';
import { and, implies, not, or, type TruthValue, xor } from './logic.ts';

const T = true;
const F = false;
const E = undefined; // the empty collection

type Row = readonly [left: TruthValue, right: TruthValue, expected: TruthValue];

/** Labels a row like the spec's tables, with `{}` for empty. */
function label(value: TruthValue): string {
  return value === undefined ? '{}' : String(value);
}

// Every cell of the truth tables in https://hl7.org/fhirpath/N1/#boolean-logic.
describe('three-valued logic', () => {
  // https://hl7.org/fhirpath/N1/#and
  const AND: readonly Row[] = [
    [T, T, T],
    [T, F, F],
    [T, E, E],
    [F, T, F],
    [F, F, F],
    [F, E, F],
    [E, T, E],
    [E, F, F],
    [E, E, E],
  ];

  // https://hl7.org/fhirpath/N1/#or
  const OR: readonly Row[] = [
    [T, T, T],
    [T, F, T],
    [T, E, T],
    [F, T, T],
    [F, F, F],
    [F, E, E],
    [E, T, T],
    [E, F, E],
    [E, E, E],
  ];

  // https://hl7.org/fhirpath/N1/#xor
  const XOR: readonly Row[] = [
    [T, T, F],
    [T, F, T],
    [T, E, E],
    [F, T, T],
    [F, F, F],
    [F, E, E],
    [E, T, E],
    [E, F, E],
    [E, E, E],
  ];

  // https://hl7.org/fhirpath/N1/#implies
  const IMPLIES: readonly Row[] = [
    [T, T, T],
    [T, F, F],
    [T, E, E],
    [F, T, T],
    [F, F, T],
    [F, E, T],
    [E, T, T],
    [E, F, E],
    [E, E, E],
  ];

  it.each(AND.map(([l, r, x]) => [label(l), label(r), label(x), l, r, x] as const))(
    '%s and %s = %s',
    (_l, _r, _x, left, right, expected) => {
      expect(and(left, right)).toBe(expected);
    },
  );

  it.each(OR.map(([l, r, x]) => [label(l), label(r), label(x), l, r, x] as const))(
    '%s or %s = %s',
    (_l, _r, _x, left, right, expected) => {
      expect(or(left, right)).toBe(expected);
    },
  );

  it.each(XOR.map(([l, r, x]) => [label(l), label(r), label(x), l, r, x] as const))(
    '%s xor %s = %s',
    (_l, _r, _x, left, right, expected) => {
      expect(xor(left, right)).toBe(expected);
    },
  );

  it.each(IMPLIES.map(([l, r, x]) => [label(l), label(r), label(x), l, r, x] as const))(
    '%s implies %s = %s',
    (_l, _r, _x, left, right, expected) => {
      expect(implies(left, right)).toBe(expected);
    },
  );

  // https://hl7.org/fhirpath/N1/#not-boolean
  it.each([
    ['true', T, F],
    ['false', F, T],
    ['{}', E, E],
  ] as const)('(%s).not() = %s', (_label, value, expected) => {
    expect(not(value)).toBe(expected);
  });

  it('covers every combination of operands', () => {
    for (const table of [AND, OR, XOR, IMPLIES]) {
      const pairs = new Set(table.map(([left, right]) => `${label(left)},${label(right)}`));
      expect(pairs.size).toBe(9);
    }
  });
});
