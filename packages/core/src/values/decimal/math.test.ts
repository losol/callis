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

  it.each([['0'], ['-1']])('ln(%s) is empty', (text) => {
    expect(ln(d(text))).toBeUndefined();
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

  it('is empty when the base is too large for a number', () => {
    expect(log(d('10'), Decimal.of(10n ** 400n))).toBeUndefined();
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
    expect(power(Decimal.of(10n ** 10_000n), d('1'))).toBeUndefined();
    expect(power(Decimal.of(-(10n ** 10_000n)), d('1'))).toBeUndefined();
    expect(power(d('10'), d('10001'))).toBeUndefined();
    expect(power(d('2'), Decimal.of(10n ** 400n))).toBeUndefined();
    expect(power(d('0.1'), d('10001'))).toBeUndefined();
    expect(power(d('2'), d('-100000'))).toBeUndefined();
  });

  it('keeps 0, 1 and -1 exact for any whole exponent', () => {
    const huge = Decimal.of(10n ** 400n);
    expect(show(power(d('1'), huge))).toBe('1');
    expect(show(power(d('-1'), huge))).toBe('1');
    expect(show(power(d('-1'), huge.add(Decimal.ONE)))).toBe('-1');
    expect(show(power(d('0'), huge))).toBe('0');
    expect(show(power(d('-1'), huge.negate()))).toBe('1');
  });
});
