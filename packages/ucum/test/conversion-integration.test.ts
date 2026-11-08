import { describe, expect, it } from 'vitest';
import { evaluate } from '../../core/src/api/compile.ts';
import { ucum } from '../src/index.ts';

/** The result items as FHIRPath text, so a quantity shows its value, precision and unit. */
function text(expression: string): string[] {
  return evaluate({}, expression, { units: ucum, output: 'typed' }).map(String);
}

// The 3.0.0 toQuantity(unit) and convertsToQuantity(unit) examples, with the UCUM provider.
// https://hl7.org/fhirpath/STU3/en/index.html#toquantityunit--string--quantity
// https://hl7.org/fhirpath/STU3/en/index.html#convertstoquantityunit--string--boolean
// https://hl7.org/fhirpath/STU3/en/index.html#time-valued-unit-conversions
describe('toQuantity(unit) and convertsToQuantity(unit) with the UCUM provider', () => {
  it.each([
    ["52 'cm'.toQuantity('m')", "0.52 'm'"],
    ["1 'a'.toQuantity('d')", "365.25 'd'"],
    ["1 'wk'.toQuantity('d')", "7 'd'"],
    ['42.toQuantity()', "42 '1'"],
    ["7 days.toQuantity('wk')", "1 'wk'"],
    ["182.5 days.toQuantity('a')", "0.5 'a'"],
    // Recurring ratios keep 28 significant digits (docs/spec-notes.md#recurring-time-conversion-precision).
    ["182.5 'd'.toQuantity('a')", "0.4996577686516084873374401095 'a'"],
    ["185 '[lb_av]'.toQuantity('kg')", "83.91458845 'kg'"],
    ["10 'Cel'.toQuantity('[degF]')", "50 '[degF]'"],
    ["'10 \\'mm[Hg]\\''.toQuantity('kPa')", "1.33322 'kPa'"],
    ["'4 days'.toQuantity('h')", "96 'h'"],
  ] as const)('%s is %s', (expression, expected) => {
    expect(text(expression)).toEqual([expected]);
  });

  it.each([
    // "There is no conversion from the UCUM default unit to meters."
    "45.toQuantity('m')",
    // "there is no conversion between these units in UCUM"
    "24 'm'.toQuantity('kg')",
    "1 'kg'.toQuantity('foo')",
    // A year has no calendar counterpart among the other UCUM time units (docs/spec-notes.md).
    "1 year.toQuantity('a_j')",
  ])('%s is empty', (expression) => {
    expect(text(expression)).toEqual([]);
  });

  it.each([
    ["'1 day'.convertsToQuantity()", true],
    ["10 'mg'.convertsToQuantity()", true],
    ["2 '[in_i]'.convertsToQuantity('cm')", true],
    ["10 'Cel'.convertsToQuantity('[degF]')", true],
    ["5 'm'.convertsToQuantity('kg')", false],
    ["45.convertsToQuantity('m')", false],
  ] as const)('%s is %s', (expression, expected) => {
    expect(evaluate({}, expression, { units: ucum })).toEqual([expected]);
  });
});
