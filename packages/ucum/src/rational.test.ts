import { describe, expect, it } from 'vitest';
import {
  add,
  compare,
  divide,
  MAX_RATIONAL_BITS,
  multiply,
  ONE,
  parseDecimalText,
  power,
  type Rational,
  rational,
  subtract,
} from './rational.ts';

const r = (numerator: bigint, denominator = 1n): Rational | undefined =>
  rational(numerator, denominator);
const text = (value: Rational | undefined): string | undefined =>
  value === undefined ? undefined : `${value.numerator}/${value.denominator}`;

describe('rational', () => {
  it('normalizes sign and lowest terms', () => {
    expect(text(r(6n, -4n))).toBe('-3/2');
    expect(text(r(0n, 5n))).toBe('0/1');
    expect(r(1n, 0n)).toBeUndefined();
  });

  it('does exact arithmetic', () => {
    const third = r(1n, 3n) ?? ONE;
    const half = r(1n, 2n) ?? ONE;
    expect(text(add(third, half))).toBe('5/6');
    expect(text(subtract(third, half))).toBe('-1/6');
    expect(text(multiply(third, half))).toBe('1/6');
    expect(text(divide(third, half))).toBe('2/3');
    expect(divide(third, r(0n) ?? ONE)).toBeUndefined();
    expect(compare(third, half)).toBe(-1);
    expect(compare(half, third)).toBe(1);
    expect(compare(half, r(2n, 4n) ?? ONE)).toBe(0);
  });

  it('raises to integer powers', () => {
    const tenth = r(1n, 10n) ?? ONE;
    expect(text(power(tenth, 3))).toBe('1/1000');
    expect(text(power(tenth, -2))).toBe('100/1');
    expect(text(power(tenth, 0))).toBe('1/1');
    expect(text(power(ONE, 1_000_000_000))).toBe('1/1');
    expect(power(r(0n) ?? ONE, -1)).toBeUndefined();
  });

  it('rejects magnitudes beyond the size bound before computing them', () => {
    const start = Date.now();
    expect(power(r(10n) ?? ONE, 1_000_000_000)).toBeUndefined();
    expect(power(r(3n) ?? ONE, MAX_RATIONAL_BITS)).toBeUndefined();
    expect(r(2n ** BigInt(MAX_RATIONAL_BITS))).toBeUndefined();
    expect(r(2n ** BigInt(MAX_RATIONAL_BITS - 1))).toBeDefined();
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  // The number format of the essence file's value attributes.
  it.each([
    ['1', '1/1'],
    ['1e3', '1000/1'],
    ['1e-3', '1/1000'],
    ['980665e-5', '196133/20000'],
    ['254e-2', '127/50'],
    ['6.02214076', '150553519/25000000'],
    ['1.66053906660e-24', '8302695333/5000000000000000000000000000000000'],
    ['-1.5', '-3/2'],
    ['+2E2', '200/1'],
  ])('parses %s', (input, expected) => {
    expect(text(parseDecimalText(input))).toBe(expected);
  });

  it.each(['', '.5', '1.', '1e', 'e3', '1 e3', '0x10', '1e99999', '1e-99999'])(
    'rejects %j',
    (input) => {
      expect(parseDecimalText(input)).toBeUndefined();
    },
  );
});
