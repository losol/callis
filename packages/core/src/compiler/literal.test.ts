import { describe, expect, it } from 'vitest';
import { parse } from '../parser/parser.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { Quantity } from '../values/quantity/quantity.ts';
import { constantOf, materialize } from './literal.ts';

/** The constant of an expression, materialized: its items, or the invalid-literal message. */
function fold(expression: string): readonly unknown[] | string | undefined {
  const constant = constantOf(parse(expression));
  if (constant === undefined) {
    return undefined;
  }
  const result = materialize(constant);
  return 'items' in result ? result.items.map(String) : result.invalid;
}

// https://hl7.org/fhirpath/N1/#literals
describe('literal constants', () => {
  it.each<[string, readonly unknown[]]>([
    ['true', ['true']],
    ["'a'", ['a']],
    ['{}', []],
    ['7', ['7']],
    ['007', ['7']],
    ['1.50', ['1.50']],
    ['@2015-02-04', ['2015-02-04']],
    ['@T14:34', ['14:34']],
    ["5 'mg'", ["5 'mg'"]],
    ['2 weeks', ['2 week']],
  ])('%s', (expression, expected) => {
    expect(fold(expression)).toEqual(expected);
  });

  it('builds frozen collections', () => {
    const constant = constantOf(parse('1.5'));
    const result = constant === undefined ? undefined : materialize(constant);
    expect(result !== undefined && 'items' in result && Object.isFrozen(result.items)).toBe(true);
  });
});

// Constant folding of the polarity operators: https://hl7.org/fhirpath/N1/#math
describe('folding + and -', () => {
  it.each<[string, readonly unknown[]]>([
    ['-1', ['-1']],
    ['+1', ['1']],
    ['- -1', ['1']],
    ['-2147483648', ['-2147483648']],
    ['-1.50', ['-1.50']],
    ['-0.0', ['0.0']],
    ["-5.5 'mg'", ["-5.5 'mg'"]],
    ['-(1)', ['-1']],
  ])('%s', (expression, expected) => {
    expect(fold(expression)).toEqual(expected);
  });

  it('keeps the unit of a negated quantity', () => {
    const constant = constantOf(parse("-2 'cm'"));
    const result = constant === undefined ? undefined : materialize(constant);
    const [quantity] = result !== undefined && 'items' in result ? result.items : [];
    expect(quantity).toBeInstanceOf(Quantity);
    expect(quantity instanceof Quantity && quantity.value).toEqual(Decimal.parse('-2'));
  });

  it.each(["-'a'", '-true', '-@2015', '-{}', 'a', '-a', '1 + 1'])(
    'does not fold %s, so it is evaluated',
    (expression) => {
      expect(fold(expression)).toBeUndefined();
    },
  );
});

// https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#invalid-literal-values
describe('invalid literal values', () => {
  it.each([
    ['@2015-02-30', 'not a valid Date'],
    ['@T14:34:28Z', 'not a valid Time'],
    ['2147483648', '32-bit'],
    ['-2147483649', '32-bit'],
    ['- -2147483648', '32-bit'],
    [`1.${'0'.repeat(10_001)}`, 'size bound'],
  ])('%s becomes an invalid constant', (expression, message) => {
    expect(fold(expression)).toContain(message);
  });

  it('keeps an invalid literal invalid under + and -', () => {
    expect(fold('-@2015-02-30')).toContain('not a valid Date');
    expect(fold('-2147483648')).toEqual(['-2147483648']);
    expect(fold(`-1.${'0'.repeat(10_001)}`)).toContain('size bound');
  });
});
