import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal.ts';
import { exp, ln, log, power, sqrt } from './math.ts';

/** Parses decimal text that a test knows is valid. */
function d(text: string): Decimal {
  const value = Decimal.parse(text);
  if (value === undefined) {
    throw new Error(`Invalid decimal in test: ${text}`);
  }
  return value;
}

/** The text of a result, or undefined for an empty result. */
function show(value: Decimal | undefined): string | undefined {
  return value?.toString();
}

describe('sqrt', () => {
  // https://hl7.org/fhirpath/N1/#sqrt-decimal and the HL7 testSqrt group
  it.each([
    ['81', '9'], // N1 example "9.0", testSqrt1
    ['2', '1.4142135623731'], // 15 significant digits, trailing zero removed
    ['0.25', '0.5'],
    ['0', '0'],
    ['0.0', '0'],
  ])('sqrt(%s) = %s', (text, expected) => {
    expect(show(sqrt(d(text)))).toBe(expected);
  });

  it.each([
    ['-1'], // N1 example, testSqrt2
    ['-0.0001'],
  ])('sqrt(%s) is empty', (text) => {
    expect(sqrt(d(text))).toBeUndefined();
  });

  it('is empty when the input is too large for a number', () => {
    expect(sqrt(Decimal.of(10n ** 400n))).toBeUndefined();
  });
});

describe('exp', () => {
  // https://hl7.org/fhirpath/N1/#exp-decimal and the HL7 testExp group
  it.each([
    ['0', '1'], // N1 example "1.0", testExp1
    ['-0.0', '1'], // N1 example, testExp2
    ['1', '2.71828182845905'],
    ['-1', '0.367879441171442'],
  ])('exp(%s) = %s', (text, expected) => {
    expect(show(exp(d(text)))).toBe(expected);
  });

  it('is empty when the result overflows', () => {
    expect(exp(d('1000'))).toBeUndefined();
  });

  it('is empty when the result underflows to zero', () => {
    expect(exp(d('-1000'))).toBeUndefined();
  });
});

describe('ln', () => {
  // https://hl7.org/fhirpath/N1/#ln-decimal and the HL7 testLn group
  it.each([
    ['1', '0'], // N1 example "0.0", testLn1
    ['1.0', '0'], // N1 example, testLn2
    ['2.71828182845905', '1'],
    ['10', '2.30258509299405'],
  ])('ln(%s) = %s', (text, expected) => {
    expect(show(ln(d(text)))).toBe(expected);
  });

  // Expected values checked with Python's decimal module at 60 digits, rounded to 15.
  it.each([
    ['1.000001', '0.000000999999500000333'],
    ['1.0000000001', '0.000000000099999999995'],
    ['1.00000000000000001', '0.00000000000000001'], // the nearest number to the input is 1
    ['0.9999999', '-0.000000100000005'],
    ['1.4', '0.336472236621213'],
    ['0.75', '-0.287682072451781'],
    ['0.5', '-0.693147180559945'],
  ])('keeps 15 significant digits near 1: ln(%s) = %s', (text, expected) => {
    expect(show(ln(d(text)))).toBe(expected);
  });

  it.each([['0'], ['-1']])('ln(%s) is empty', (text) => {
    expect(ln(d(text))).toBeUndefined();
  });

  it('gives ln(1 + d) = d within 1e-20 of 1, at any distance', () => {
    // ln(1 + 1e-400) and ln(1 - 1e-30); the differences are far below the number range.
    expect(show(ln(Decimal.of(10n ** 400n + 1n, 400)))).toBe(Decimal.of(1n, 400).toString());
    expect(show(ln(Decimal.of(10n ** 30n - 1n, 30)))).toBe(Decimal.of(-1n, 30).toString());
  });

  it('removes the trailing zero when rounding carries the significand to 10', () => {
    // ln(1 + 9.999999999999999e-22): the 16 nines round up to 1e-21, not 1.0e-21.
    expect(show(ln(Decimal.of(10n ** 37n + 9999999999999999n, 37)))).toBe(
      Decimal.of(1n, 21).toString(),
    );
  });

  // Expected values checked with Python's decimal module at 450 digits, rounded to 15.
  it.each([
    ['1e-400', Decimal.of(1n, 400), '-921.034037197618'],
    ['1e400', Decimal.of(10n ** 400n), '921.034037197618'],
    ['1e-320', Decimal.of(1n, 320), '-736.827229758095'], // a subnormal number would give -736.827240890974
    ['2.5e-310', Decimal.of(25n, 311), '-712.88508809628'],
  ])('keeps 15 significant digits beyond the number range: ln(%s) = %s', (_, value, expected) => {
    expect(show(ln(value))).toBe(expected);
  });
});

describe('log', () => {
  // https://hl7.org/fhirpath/N1/#logbase-decimal-decimal and the HL7 testLog group
  it.each([
    ['16', '2', '4'], // N1 example "4.0", testLog1
    ['100.0', '10.0', '2'], // N1 example "2.0", testLog2
    ['1000', '10', '3'], // Math.log gives 2.9999999999999996; 15 digits round it
    ['8', '2', '3'],
    ['1', '10', '0'],
    ['2', '4', '0.5'],
  ])('log(%s, %s) = %s', (value, base, expected) => {
    expect(show(log(d(value), d(base)))).toBe(expected);
  });

  // Expected values checked with Python's decimal module at 60 digits, rounded to 15.
  it.each([
    ['7', '1.0000001', '19459102.4635082'],
    ['2', '0.9999', '-6931.12522623266'],
    ['1.000001', '10', '0.000000434294264756156'],
  ])('keeps 15 significant digits near 1: log(%s, %s) = %s', (value, base, expected) => {
    expect(show(log(d(value), d(base)))).toBe(expected);
  });

  it.each([
    ['0', '10'],
    ['-1', '10'],
    ['10', '0'],
    ['10', '-2'],
    ['10', '1'],
    ['1', '1'],
  ])('log(%s, %s) is empty', (value, base) => {
    expect(log(d(value), d(base))).toBeUndefined();
  });

  // Expected values checked with Python's decimal module at 450 digits, rounded to 15.
  it.each([
    // Both differences, 1e-323 and 1.1e-323, would round to the same subnormal number.
    [
      '1 + 1e-323, 1 + 1.1e-323',
      Decimal.of(10n ** 324n + 10n, 324),
      Decimal.of(10n ** 324n + 11n, 324),
      '0.909090909090909',
    ],
    ['10, 1e400', d('10'), Decimal.of(10n ** 400n), '0.0025'],
    [
      '1.00001, 1 + 1e-300',
      d('1.00001'),
      Decimal.of(10n ** 300n + 1n, 300),
      `999995000033333${'0'.repeat(280)}`,
    ],
  ])(
    'keeps 15 significant digits beyond the number range: log(%s) = %s',
    (_, value, base, expected) => {
      expect(show(log(value, base))).toBe(expected);
    },
  );

  describe('within the Decimal size bound', () => {
    // 1 − 1e-10000 and 1 + 1e-9999 are the closest values to 1 within the bound.
    const belowOne = Decimal.of(10n ** 10_000n - 1n, 10_000);
    const aboveOne = Decimal.of(10n ** 9_999n + 1n, 9_999);

    it('keeps results at the bound', () => {
      expect(show(ln(belowOne))).toBe(Decimal.of(-1n, 10_000).toString());
      // Checked with Python's decimal module at 20,100 digits: 6.93147180559945e+9998.
      expect(show(log(d('2'), aboveOne))).toBe(`693147180559945${'0'.repeat(9_984)}`);
      expect(show(log(d('1'), belowOne))).toBe('0');
    });

    it('is empty for results beyond it', () => {
      expect(log(d('10'), belowOne)).toBeUndefined(); // -2.3e10000 overflows
      expect(log(aboveOne, Decimal.of(10n ** 9_999n))).toBeUndefined(); // 4.3e-10004 underflows
    });
  });
});

describe('power', () => {
  // https://hl7.org/fhirpath/N1/#powerexponent-integer-decimal-integer-decimal,
  // https://hl7.org/fhirpath/STU3/#powerexponent--integer--decimal--decimal and the HL7 testPower group
  it.each([
    ['2', '3', '8'], // N1 example, testPower1, T0004 acceptance criterion
    ['2.5', '2', '6.25'], // N1 example, testPower2, T0004 acceptance criterion
    ['2', '-1', '0.5'], // 3.0.0 example, T0004 acceptance criterion
    ['3', '-1', '0.3333333333333333333333333333'], // 28 significant digits
    ['2', '-3', '0.125'],
    ['-2', '3', '-8'],
    ['-2', '2', '4'],
    ['-2', '-1', '-0.5'],
    ['1.1', '2', '1.21'],
    ['1.0', '3', '1.000'], // the scale grows as with repeated multiplication
    ['0.1', '3', '0.001'],
    ['10', '20', '100000000000000000000'],
    ['2', '0', '1'],
    ['0', '0', '1'],
    ['0', '2', '0'],
    ['0.0', '2', '0.00'],
    ['2', '3.0', '8'], // a whole exponent with a fractional part of zeros is still exact
    ['4', '0.5', '2'], // through Math.pow
    ['2', '0.5', '1.4142135623731'],
    ['8', '-0.5', '0.353553390593274'],
    ['0', '0.5', '0'],
    ['2', '2.0000000000000001', '4'], // through Math.pow: the exponent's nearest number is 2
  ])('power(%s, %s) = %s', (base, exponent, expected) => {
    expect(show(power(d(base), d(exponent)))).toBe(expected);
  });

  it('is exact for non-negative whole exponents', () => {
    // Checked with Python's decimal module: Decimal('1.5') ** 40.
    expect(show(power(d('1.5'), d('40')))).toBe(
      '11057332.3209400121422731899656355381011962890625',
    );
    expect(show(power(d('3'), d('50')))).toBe('717897987691852588770249');
  });

  it.each([
    ['-1', '0.5'], // N1 example, testPower3
    ['-8', '0.5'],
    ['-2', '2.0000000000000001'], // fractional, although its nearest number is 2
    ['-8', '-0.5'],
    ['0', '-1'], // like division by zero, T0004 acceptance criterion
    ['0.0', '-2'],
    ['0', '-0.5'],
    ['10', '400.5'], // overflows a number
    ['0.1', '400.5'], // underflows a number
  ])('power(%s, %s) is empty', (base, exponent) => {
    expect(power(d(base), d(exponent))).toBeUndefined();
  });

  it('is empty when an exact result would have more than 10,000 digits', () => {
    expect(power(d('10'), d('9999'))?.toString()).toHaveLength(10_000);
    expect(power(d('-10'), d('9999'))?.toString()).toHaveLength(10_001); // with the sign
    // 10^10000 has 10,001 digits, although its log10 is exactly 10,000.
    expect(power(d('10'), d('10000'))).toBeUndefined();
    // The largest Decimal (10,000 nines) raised to 1 stays; squared it overflows.
    const largest = Decimal.of(10n ** 10_000n - 1n);
    expect(power(largest, d('1'))?.equals(largest)).toBe(true);
    expect(power(largest.negate(), d('1'))?.equals(largest.negate())).toBe(true);
    expect(power(largest, d('2'))).toBeUndefined();
    expect(power(d('10'), d('10001'))).toBeUndefined();
    expect(power(d('2'), Decimal.of(10n ** 400n))).toBeUndefined();
    expect(power(d('0.1'), d('10001'))).toBeUndefined();
    expect(power(d('2'), d('-100000'))).toBeUndefined();
    // For a negative exponent the bound applies to the denominator 2^40000 (12,042 digits).
    expect(power(d('2'), d('-30000'))?.toString()).toMatch(/^0\.0{9030}1/);
    expect(power(d('2'), d('-40000'))).toBeUndefined();
    // The scale is bounded too, even when the value is 0 or 1.
    expect(power(d('1.0'), d('100000'))).toBeUndefined();
    expect(power(d('0.0'), d('100000'))).toBeUndefined();
  });

  it('keeps 0, 1 and -1 exact for any whole exponent', () => {
    const huge = Decimal.of(10n ** 400n);
    expect(show(power(d('1'), huge))).toBe('1');
    expect(show(power(d('-1'), huge))).toBe('1');
    expect(show(power(d('-1'), Decimal.of(10n ** 400n + 1n)))).toBe('-1');
    expect(show(power(d('0'), huge))).toBe('0');
    expect(show(power(d('-1'), huge.negate()))).toBe('1');
  });
});
