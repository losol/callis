import { describe, expect, it } from 'vitest';
import {
  MAX_GROUP_DEPTH,
  parseUnitExpression,
  type UnitComponent,
  type UnitTermSyntax,
} from './unit-expression.ts';

/** A compact rendering of the syntax tree: `*` before multiplied and `/` before divided parts. */
function show(term: UnitTermSyntax | undefined): string | undefined {
  if (term === undefined) return undefined;
  return term.factors
    .map(({ operator, component }) => `${operator === 1 ? '*' : '/'}${showComponent(component)}`)
    .join(' ');
}

function showComponent(component: UnitComponent): string {
  switch (component.kind) {
    case 'symbol':
      return `${component.symbol}^${component.exponent}${component.annotation === undefined ? '' : `{${component.annotation}}`}`;
    case 'number':
      return `#${component.value}^${component.exponent}`;
    case 'annotation':
      return `{${component.text}}`;
    case 'group':
      return `(${show(component.term)})`;
  }
}

// https://ucum.org/ucum#section-Syntax-Rules
describe('parseUnitExpression', () => {
  it.each([
    ['m', '*m^1'],
    ['mg/dL', '*mg^1 /dL^1'],
    ['kg.m/s2', '*kg^1 *m^1 /s^2'],
    // §7■4: left to right with equal precedence, so kg is divided, not multiplied.
    ['mL/min/kg', '*mL^1 /min^1 /kg^1'],
    ['J/kg.K', '*J^1 /kg^1 *K^1'],
    // §7■3: a leading solidus inverts only the unit that follows it.
    ['/s', '/s^1'],
    ['/[pi].A/m', '/[pi]^1 *A^1 /m^1'],
    ['cm-1', '*cm^-1'],
    ['s+2', '*s^2'],
    ['m0', '*m^0'],
    ['10*3/uL', '*10*^3 /uL^1'],
    ['10*-7', '*10*^-7'],
    ['10^6', '*10^^6'],
    ['4.[pi].10*-7.N/A2', '*#4^1 *[pi]^1 *10*^-7 *N^1 /A^2'],
    // §8: digits are a number; 2.5 is 2 × 5.
    ['2.5', '*#2^1 *#5^1'],
    ['12a', '*12a^1'],
    // §9: an explicit sign separates an exponent from a number.
    ['2+10', '*#2^10'],
    ['10-3', '*#10^-3'],
    ["[in_i'H2O]", "*[in_i'H2O]^1"],
    ['m[Hg].[in_i]/m', '*m[Hg]^1 *[in_i]^1 /m^1'],
    ['B[10.nV]', '*B[10.nV]^1'],
    ['[m/s2/Hz^(1/2)]', '*[m/s2/Hz^(1/2)]^1'],
    ['[CCID_50]2', '*[CCID_50]^2'],
    ["'/60", "*'^1 /#60^1"],
    // §12: annotations.
    ['{RBC}', '*{RBC}'],
    ['{RBC}/uL', '*{RBC} /uL^1'],
    ['mg{total}', '*mg^1{total}'],
    ['kg2{x.y/z}', '*kg^2{x.y/z}'],
    ['{}', '*{}'],
    // §10: nested terms.
    ['(m/s)', '*(*m^1 /s^1)'],
    ['kg/(m.s2)', '*kg^1 /(*m^1 *s^2)'],
    ['((m))', '*(*(*m^1))'],
  ])('parses %s', (text, expected) => {
    expect(show(parseUnitExpression(text))).toBe(expected);
  });

  it.each([
    ['empty', ''],
    ['a space', 'm s'],
    ['leading whitespace', ' m'],
    ['a non-ASCII character', 'µg'],
    ['a trailing operator', 'm.'],
    ['a leading period', '.m'],
    ['two operators', 'm//s'],
    ['a double leading solidus', '//s'],
    ['an unclosed group', '(m'],
    ['an unopened group', 'm)'],
    ['an empty group', '()'],
    ['an exponent on a group (stricken from §10)', '(m)2'],
    ['a group after a symbol', 'm(s)'],
    ['an unclosed bracket', '[m'],
    ['an unopened bracket', 'm]'],
    ['an unclosed annotation', '{a'],
    ['a nested annotation', '{a{b}}'],
    ['an exponent after an annotation', 'm{a}2'],
    ['an annotation on a number', '10{a}'],
    ['two annotations', 'm{a}{b}'],
    ['an exponent beyond the safe integer range', 'm99999999999999999999'],
  ])('rejects %s', (_, text) => {
    expect(parseUnitExpression(text)).toBeUndefined();
  });

  it('limits the nesting of groups', () => {
    const nested = (depth: number): string => `${'('.repeat(depth)}m${')'.repeat(depth)}`;
    expect(parseUnitExpression(nested(MAX_GROUP_DEPTH))).toBeDefined();
    expect(parseUnitExpression(nested(MAX_GROUP_DEPTH + 1))).toBeUndefined();
    expect(parseUnitExpression(nested(100_000))).toBeUndefined();
  });

  // A backtracking exponent pattern took quadratic time on such input.
  it('parses long symbols and terms', () => {
    expect(parseUnitExpression(`${'1'.repeat(200_000)}x`)).toBeDefined();
    expect(parseUnitExpression(`m${'.m'.repeat(50_000)}`)?.factors).toHaveLength(50_001);
  });
});
