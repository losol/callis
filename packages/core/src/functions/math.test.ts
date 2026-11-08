import { describe, expect, it } from 'vitest';
import { evaluate } from '../index.ts';
import { createRegistry } from './registry.ts';

// Decimals are read as exact text, so `8` (an Integer) and `'8'` (a Decimal) differ.
function run(expression: string, input: unknown = {}): unknown[] {
  return evaluate(input, expression, { decimalOutput: 'string' });
}

/** A UCUM quantity of milligrams in plain output. */
function mg(value: string): object {
  return { value, unit: 'mg', system: 'http://unitsofmeasure.org', code: 'mg' };
}

function caught(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

// N1 §5.7: https://hl7.org/fhirpath/N1/#math
// The examples of each function, then the HL7 tests of its group (testAbs, testCeiling, …).
describe('the math functions: spec examples', () => {
  it.each([
    // https://hl7.org/fhirpath/N1/#abs-integer-decimal-quantity
    ['(-5).abs()', [5]], // testAbs1
    ['(-5.5).abs()', ['5.5']], // testAbs2
    ["(-5.5 'mg').abs()", [mg('5.5')]], // testAbs3
    // https://hl7.org/fhirpath/N1/#ceiling-integer
    ['1.ceiling()', [1]], // testCeiling1
    ['1.1.ceiling()', [2]], // testCeiling3
    ['(-1.1).ceiling()', [-1]], // testCeiling2
    // https://hl7.org/fhirpath/N1/#exp-decimal
    ['0.exp()', ['1']], // testExp1
    ['(-0.0).exp()', ['1']], // testExp2
    // https://hl7.org/fhirpath/N1/#floor-integer
    ['1.floor()', [1]], // testFloor1
    ['2.1.floor()', [2]], // testFloor2
    ['(-2.1).floor()', [-3]], // testFloor3
    // https://hl7.org/fhirpath/N1/#ln-decimal
    ['1.ln()', ['0']], // testLn1
    ['1.0.ln()', ['0']], // testLn2
    // https://hl7.org/fhirpath/N1/#logbase-decimal-decimal
    ['16.log(2)', ['4']], // testLog1
    ['100.0.log(10.0)', ['2']], // testLog2
    // https://hl7.org/fhirpath/N1/#powerexponent-integer-decimal-integer-decimal
    ['2.power(3)', ['8']], // testPower1
    ['2.5.power(2)', ['6.25']], // testPower2
    ['(-1).power(0.5)', []], // testPower3
    // https://hl7.org/fhirpath/N1/#roundprecision-integer-decimal
    ['1.round()', ['1']], // testRound1
    ['3.14159.round(3)', ['3.142']], // testRound2
    // https://hl7.org/fhirpath/N1/#sqrt-decimal
    ['81.sqrt()', ['9']], // testSqrt1
    ['(-1).sqrt()', []], // testSqrt2
    // https://hl7.org/fhirpath/N1/#truncate-integer
    ['101.truncate()', [101]], // testTruncate1
    ['1.00000001.truncate()', [1]], // testTruncate2
    ['(-1.56).truncate()', [-1]], // testTruncate3
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });

  // The spec shows `1.0`, `0.0`, `4.0` and `9.0`: equality ignores the scale of a Decimal.
  it.each([
    '0.exp() = 1.0',
    '1.ln() = 0.0', // testLn1
    '16.log(2) = 4.0', // testLog1
    '100.0.log(10.0) = 2.0', // testLog2
    '81.sqrt() = 9.0', // testSqrt1
    "(-5.5 'mg').abs() = 5.5 'mg'", // testAbs3
  ])('%s', (expression) => {
    expect(run(expression)).toEqual([true]);
  });

  // The BMI example of the section: https://hl7.org/fhirpath/N1/#math
  it('calculates the Body Mass Index example', () => {
    expect(run('(weight / (height.power(2))).round(1)', { weight: 70, height: 1.75 })).toEqual([
      '22.9',
    ]);
  });
});

describe('the result types', () => {
  it.each([
    ['(-5).abs()', 'Integer'],
    ['(-5.5).abs()', 'Decimal'],
    ['5.ceiling()', 'Integer'],
    ['5.5.ceiling()', 'Integer'],
    ['5.5.floor()', 'Integer'],
    ['5.5.truncate()', 'Integer'],
    ['0.exp()', 'Decimal'],
    ['1.ln()', 'Decimal'],
    ['16.log(2)', 'Decimal'],
    ['81.sqrt()', 'Decimal'],
    // 3.0.0: the result of power() is always a Decimal, because 2.power(-1) is not an Integer.
    // https://hl7.org/fhirpath/STU3/#powerexponent--integer--decimal--decimal
    ['2.power(3)', 'Decimal'],
    ['2.power(0.5)', 'Decimal'],
    // 3.0.0: Integer is converted to Decimal first. https://hl7.org/fhirpath/STU3/#roundprecision--integer--decimal--quantity
    ['1.round()', 'Decimal'],
    ['1.5.round()', 'Decimal'],
  ])('%s is a %s', (expression, type) => {
    expect(run(`${expression}.is(${type})`)).toEqual([true]);
  });
});

describe('abs', () => {
  it.each([
    ['0.abs()', [0]],
    ['(-0.0).abs()', ['0.0']],
    ['(-2147483647).abs()', [2147483647]],
    ['(-1.50).abs()', ['1.50']], // keeps the scale
    ["(-3 'kg').abs()", [{ ...mg('3'), unit: 'kg', code: 'kg' }]], // the unit is unchanged
    ['(-3 days).abs()', [{ value: '3', unit: 'day' }]], // a calendar unit stays one
    ["(5.5 'mg').abs()", [mg('5.5')]],
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });

  // 2147483648 is not an Integer, so the overflow is empty. https://hl7.org/fhirpath/STU3/#math-1
  it('is empty when the absolute value is outside the Integer range', () => {
    expect(run('(-2147483647 - 1).abs()')).toEqual([]);
  });
});

describe('ceiling, floor and truncate', () => {
  it.each([
    ['0.ceiling()', [0]],
    ['(-0.5).ceiling()', [0]],
    ['0.5.floor()', [0]],
    ['(-0.5).floor()', [-1]],
    ['(-0.5).truncate()', [0]],
    ['2.0.ceiling()', [2]],
    ['2.0.floor()', [2]],
    ['(-7).floor()', [-7]], // an Integer is returned as it is
    ['(-7).ceiling()', [-7]],
    ['(-7).truncate()', [-7]],
    ['2147483646.5.ceiling()', [2147483647]],
    ['(-2147483648.5).ceiling()', [-2147483648]],
    ['2147483647.9.truncate()', [2147483647]],
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });

  // The whole number must be an Integer; anything else is overflow and empty.
  // https://hl7.org/fhirpath/STU3/#math-1
  it.each([
    '2147483647.5.ceiling()',
    '(-2147483648.5).floor()',
    '3000000000.5.truncate()',
    '(-3000000000.5).ceiling()',
    '10000000000.0.truncate()',
  ])('%s is empty when the result is outside the Integer range', (expression) => {
    expect(run(expression)).toEqual([]);
  });
});

describe('exp, ln and sqrt', () => {
  it.each([
    ['1.exp()', ['2.71828182845905']],
    ['(-1).exp()', ['0.367879441171442']],
    ['2.5.exp()', ['12.1824939607035']],
    ['1000.exp()', []], // overflow is empty
    ['(-1000000).exp()', []], // underflow is empty
    ['10.ln()', ['2.30258509299405']],
    ['0.ln()', []],
    ['(-1).ln()', []],
    ['0.5.ln()', ['-0.693147180559945']],
    ['2.sqrt()', ['1.4142135623731']],
    ['0.sqrt()', ['0']],
    ['0.0.sqrt()', ['0']],
    ['2.25.sqrt()', ['1.5']],
    ['(-0.5).sqrt()', []],
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });
});

describe('log', () => {
  it.each([
    ['100.log(10)', ['2']],
    ['8.log(2)', ['3']],
    ['2.log(2)', ['1']],
    ['1.log(10)', ['0']],
    ['0.5.log(2)', ['-1']],
    ['2.log(0.5)', ['-1']],
    ['10.log(1)', []], // base 1 has no logarithm: empty, like division by zero
    ['1.log(1)', []],
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });

  // 3.0.0 asks for an error: https://hl7.org/fhirpath/STU3/#logbase--decimal--decimal
  it.each(['0.log(10)', '(-1).log(10)', '0.0.log(10)', '16.log(0)', '16.log(-2)', '16.log(0.0)'])(
    '%s raises eval/invalid-argument',
    (expression) => {
      expect(caught(() => run(expression))).toMatchObject({ code: 'eval/invalid-argument' });
    },
  );

  // N1: an empty input or an empty base gives an empty result. HL7 testLogEmpty, testLogEmpty2
  // and testLogEmpty3 (R5).
  it.each(['{}.log(10)', '{}.log({})', '16.log({})', '{}.log(0)', '(-1).log({})'])(
    '%s is empty',
    (expression) => {
      expect(run(expression)).toEqual([]);
    },
  );
});

describe('power', () => {
  it.each([
    ['2.power(0)', ['1']],
    ['0.power(0)', ['1']],
    ['0.power(3)', ['0']],
    ['(-2).power(3)', ['-8']],
    ['(-2).power(2)', ['4']],
    ['2.power(-1)', ['0.5']], // 3.0.0: https://hl7.org/fhirpath/STU3/#powerexponent--integer--decimal--decimal
    ['2.power(-2)', ['0.25']],
    ['3.power(-1)', ['0.3333333333333333333333333333']],
    ['0.power(-1)', []], // like division by zero
    ['2.power(0.5)', ['1.4142135623731']],
    ['4.0.power(0.5)', ['2']],
    ['2.0.power(3.0)', ['8.000']], // a whole exponent is exact, with the scale multiplied
    ['1.5.power(2)', ['2.25']],
    ['0.power(0.5)', ['0']],
    ['2.power(100000)', []], // beyond the size of a Decimal
    ['10.power(100)', [`1${'0'.repeat(100)}`]], // far outside the Integer range, as a Decimal
    ['(-8.0).power(1.0)', ['-8.0']],
    ['(-8).power(1.0)', ['-8']],
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });

  it.each(['{}.power(2)', '{}.power({})', '2.5.power({})'])('%s is empty', (expression) => {
    // HL7 testPowerEmpty, testPowerEmpty2 and testPowerEmpty3 (R5).
    expect(run(expression)).toEqual([]);
  });
});

describe('round', () => {
  it.each([
    ['2.5.round()', ['3']], // half away from zero
    ['(-2.5).round()', ['-3']],
    ['2.4.round()', ['2']],
    ['(-2.4).round()', ['-2']],
    ['0.5.round()', ['1']],
    ['(-0.5).round()', ['-1']],
    ['3.14159.round(0)', ['3']],
    ['3.14159.round(1)', ['3.1']],
    ['3.14959.round(2)', ['3.15']],
    ['5.round(2)', ['5']],
    ['1.5.round(3)', ['1.5']], // never adds digits
    ['1.round(2147483647)', ['1']],
    ['(-1.005).round(2)', ['-1.01']],
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });

  it('is empty for an empty input and for an empty precision', () => {
    // HL7 testRoundEmpty (R5).
    expect(run('{}.round()')).toEqual([]);
    expect(run('{}.round(2)')).toEqual([]);
    expect(run('1.5.round({})')).toEqual([]);
  });

  // N1: "the number of digits of precision must be >= 0 or the evaluation will end and signal an
  // error". https://hl7.org/fhirpath/N1/#roundprecision-integer-decimal
  it.each(['1.5.round(-1)', '{}.round(-1)', '1.round(-2147483648)'])(
    '%s raises eval/invalid-argument',
    (expression) => {
      expect(caught(() => run(expression))).toMatchObject({ code: 'eval/invalid-argument' });
    },
  );
});

describe('empty input', () => {
  it.each(['abs', 'ceiling', 'exp', 'floor', 'ln', 'round', 'sqrt', 'truncate'])(
    '{}.%s() is empty',
    (name) => {
      expect(run(`{}.${name}()`)).toEqual([]);
      expect(run(`missing.${name}()`)).toEqual([]);
    },
  );
});

// N1 §5.7: "if there is more than one item, or the item is not compatible with the expected type,
// the evaluation of the expression will end and signal an error".
describe('singleton evaluation and types', () => {
  const input = { values: [1, 2], name: 'Ada', flag: true };

  it.each([
    'values.abs()',
    'values.ceiling()',
    'values.exp()',
    'values.floor()',
    'values.ln()',
    'values.log(10)',
    '10.log(values)',
    'values.power(2)',
    '2.power(values)',
    'values.round()',
    '2.5.round(values)',
    'values.sqrt()',
    'values.truncate()',
  ])('%s raises eval/singleton-expected', (expression) => {
    expect(caught(() => run(expression, input))).toMatchObject({
      code: 'eval/singleton-expected',
    });
  });

  it.each([
    'name.abs()',
    'name.ceiling()',
    'name.exp()',
    'name.floor()',
    'name.ln()',
    'name.log(10)',
    '10.log(name)',
    'name.power(2)',
    '2.power(name)',
    'name.round()',
    '2.5.round(name)',
    'name.sqrt()',
    'name.truncate()',
    'flag.abs()',
    '@2020.floor()',
    "(5 'mg').sqrt()", // a Quantity is accepted only by abs()
    "(5 'mg').ceiling()",
    "(5 'mg').round()",
    '2.5.round(1.5)', // the precision is an Integer
  ])('%s raises eval/type-mismatch', (expression) => {
    expect(caught(() => run(expression, input))).toMatchObject({ code: 'eval/type-mismatch' });
  });

  it('reads numbers from input data, as Integers or Decimals', () => {
    const data = { count: -3, ratio: -2.5, nested: { amount: 16 } };
    expect(run('count.abs()', data)).toEqual([3]);
    expect(run('ratio.abs()', data)).toEqual(['2.5']);
    expect(run('ratio.floor()', data)).toEqual([-3]);
    expect(run('nested.amount.sqrt()', data)).toEqual(['4']);
    expect(run('nested.amount.log(2)', data)).toEqual(['4']);
  });

  it('does not change frozen input', () => {
    const data = Object.freeze({ values: Object.freeze([-4]) });
    expect(run('values.abs().sqrt()', data)).toEqual(['2']);
    expect(data.values).toEqual([-4]);
  });
});

describe('the function registry', () => {
  const registry = createRegistry();

  it('has the math functions', () => {
    expect(registry.names()).toEqual(
      expect.arrayContaining([
        'abs',
        'ceiling',
        'exp',
        'floor',
        'ln',
        'log',
        'power',
        'round',
        'sqrt',
        'truncate',
      ]),
    );
  });

  it.each([
    ['abs', 1],
    ['ceiling', 1],
    ['exp', 1],
    ['floor', 1],
    ['ln', 1],
    ['log', 0],
    ['log', 2],
    ['power', 0],
    ['power', 2],
    ['round', 2],
    ['sqrt', 1],
    ['truncate', 1],
  ])('%s() with %i arguments raises semantic/wrong-arity', (name, arity) => {
    expect(caught(() => registry.resolve(name, arity))).toMatchObject({
      code: 'semantic/wrong-arity',
    });
  });

  it.each([
    ['round', 0],
    ['round', 1],
    ['log', 1],
    ['power', 1],
  ])('%s() with %i arguments resolves', (name, arity) => {
    expect(registry.resolve(name, arity).name).toBe(name);
  });
});
