import { Decimal } from '@callis/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ucum } from '../src/index.ts';

// Pieces of real unit expressions, so that random combinations often parse.
const PIECES = [
  'm',
  'g',
  's',
  'k',
  'c',
  'm',
  'u',
  'L',
  'mol',
  'Cel',
  '[degF]',
  '[iU]',
  '[in_i]',
  '10*',
  '10^',
  '%',
  "'",
  '.',
  '/',
  '(',
  ')',
  '{',
  '}',
  '[',
  ']',
  '+',
  '-',
  '0',
  '1',
  '2',
  '3',
  '9',
  'x',
  ' ',
];
const unit = fc.oneof(
  fc.string({ maxLength: 24 }),
  fc.array(fc.constantFrom(...PIECES), { maxLength: 12 }).map((parts) => parts.join('')),
);
const decimal = fc
  .tuple(fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }), fc.nat({ max: 30 }))
  .map(([coefficient, scale]) => Decimal.of(coefficient, scale));

// Unit strings come from expressions and data, so no input may throw.
describe('fuzzing', () => {
  it('never throws, and algebra results parse again', () => {
    fc.assert(
      fc.property(unit, unit, decimal, (a, b, value) => {
        ucum.parse(a);
        ucum.convert(value, a, b);
        ucum.convert(value, a, b, { equivalence: true });
        ucum.convert(value, a, b, { explicit: true });
        ucum.compare?.(value, a, value, b);
        for (const product of [ucum.multiply(a, b), ucum.divide(a, b)]) {
          if (product === undefined) continue;
          expect(product.factor.sign()).toBe(1);
          if (ucum.parse(a) !== undefined && ucum.parse(b) !== undefined) {
            expect(ucum.parse(product.unit), product.unit).toBeDefined();
          }
        }
      }),
      { numRuns: 2_000 },
    );
  });
});
