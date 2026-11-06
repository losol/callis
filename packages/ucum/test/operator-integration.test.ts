import { describe, expect, it } from 'vitest';
import { evaluate } from '../../core/src/api/compile.ts';
import { ucum } from '../src/index.ts';

// N1 §6.1/6.2/6.6 Quantity examples exercised through compiled expressions, not just kernels.
// https://hl7.org/fhirpath/N1/#quantity-equality
// https://hl7.org/fhirpath/N1/#math
// 3.0.0 clarifies calendar comparison and implicit number → Quantity conversions.
describe('compiled operators with the UCUM provider', () => {
  it.each([
    "12 'cm' * 3 'cm' = 36 'cm2'",
    "3 'cm' * 12 'cm2' = 36 'cm3'",
    "12 'cm2' / 3 'cm' = 4.0 'cm'",
    "3 'm' + 3 'cm' = 303 'cm'",
    "3 'm' - 3 'cm' = 297 'cm'",
    "4 'm' > 4 'cm'",
    "(4 'm' < 4 'cm') = false",
    "(4 'm' <= 4 'cm') = false",
    "4 'm' >= 4 'cm'",
    "1 'kg' = 1000 'g'",
    "1 'kg' != 1 'g'",
    "1 'kg' ~ 1000 'g'",
    "(1 'kg' !~ 1000 'g') = false",
    "10 'm/s' * 10 's' = 100 'm'",
    "60 / 1 's' = 60 '/s'",
    "60 's' / 1 'min' = 1 '1'",
    "1 'cm' / 1 'm' = 0.01 '1'",
    "2 * 3 'm' = 6 'm'",
    "3 'm' * 2 = 6 'm'",
    "3 'm' / 2 = 1.5 'm'",
    "2 + 3 '1' = 5 '1'",
    "3 '1' - 2 = 1 '1'",
    "7 days = 1 'wk'",
    "1 year ~ 1 'a'",
    '(6 months > 1 year) = false',
    "1 'kg' in (1000 'g' | 2 'kg')",
  ])('%s', (expression) => {
    expect(evaluate({}, expression, { units: ucum })).toEqual([true]);
  });

  it.each([
    "1 'kg' = 1 'm'",
    "1 'kg' < 1 'm'",
    "1 'unknown-unit' + 1 'other-unit'",
    "1 'kg' + 1 'm'",
    "1 'kg' / 0 's'",
    "1 'Cel' * 1 '1'",
    "1 year = 1 'a'",
    "1 year > 1 'a'",
    '1 year / 1 year',
  ])('%s returns empty', (expression) => {
    expect(evaluate({}, expression, { units: ucum })).toEqual([]);
  });

  it('uses equality for union and retains the first quantity unchanged', () => {
    const result = evaluate({}, "1 'kg' | 1000 'g' | 2 'kg'", { units: ucum });
    expect(result).toMatchObject([
      { value: 1, code: 'kg' },
      { value: 2, code: 'kg' },
    ]);
  });
});
