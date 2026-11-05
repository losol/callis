import { describe, expect, it } from 'vitest';
import { FhirPathEvaluationError } from '../../errors/fhirpath-error.ts';
import { Decimal, MAX_DECIMAL_DIGITS } from './decimal.ts';

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

function expectInvalidArgument(action: () => unknown): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(FhirPathEvaluationError);
    expect(error).toHaveProperty('code', 'eval/invalid-argument');
    return;
  }
  expect.fail('expected an eval/invalid-argument error');
}

describe('Decimal.parse', () => {
  // https://hl7.org/fhirpath/N1/#decimal and the toDecimal() string format
  // https://hl7.org/fhirpath/N1/#todecimal-decimal: (\+|-)?\d+(\.\d+)?
  it.each([
    ['0.0', 0n, 1],
    ['3.14159265', 314159265n, 8],
    ['1.50', 150n, 2],
    ['42', 42n, 0],
    ['-1.5', -15n, 1],
    ['+1.5', 15n, 1],
    ['-0.0', 0n, 1],
    ['007.10', 710n, 2],
  ])('parses %s with its scale', (text, coefficient, scale) => {
    const value = d(text);
    expect(value.coefficient).toBe(coefficient);
    expect(value.scale).toBe(scale);
  });

  it.each([
    '',
    '.5',
    '5.',
    '1.2.3',
    '1e3',
    '1.5E-2',
    ' 1.5',
    '1.5 ',
    '--1',
    '+-1',
    '1,5',
    '0x10',
    'st',
    '1.a',
    'Infinity',
    'NaN',
    '١٢', // Arabic-Indic digits: \d in the spec means ASCII digits
  ])('rejects %j', (text) => {
    expect(Decimal.parse(text)).toBeUndefined();
  });

  // N1 §4.1.4: at least 28 digits, 8 of them after the decimal point, with a step of 10^-8.
  it.each([
    '99999999999999999999.99999999',
    '-99999999999999999999.99999999',
    '0.00000001',
    '1234567890987654321.0', // testLiteralDecimalMax
  ])('keeps the required range and step: %s', (text) => {
    expect(d(text).toString()).toBe(text);
  });
});

describe('Decimal.toString', () => {
  it.each([
    ['1.0', '1.0'], // T0004 acceptance criterion, testDecimalLiteralToString
    ['0.0', '0.0'], // testToString4
    ['-0.0', '0.0'],
    ['1.50', '1.50'],
    ['-0.05', '-0.05'],
    ['100', '100'],
    ['-100', '-100'],
    ['0.00000001', '0.00000001'],
  ])('formats %s as %s, keeping the scale', (text, expected) => {
    expect(d(text).toString()).toBe(expected);
  });

  it('never uses exponent notation', () => {
    expect(Decimal.of(1n, 30).toString()).toBe('0.000000000000000000000000000001');
    expect(Decimal.of(10n ** 30n).toString()).toBe('1000000000000000000000000000000');
  });
});

describe('Decimal.of', () => {
  it('builds coefficient × 10^-scale', () => {
    expect(Decimal.of(254n, 2).toString()).toBe('2.54');
    expect(Decimal.of(-7n).toString()).toBe('-7');
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects the scale %s with eval/invalid-argument',
    (scale) => {
      expectInvalidArgument(() => Decimal.of(1n, scale));
    },
  );
});

describe('Decimal.fromNumber', () => {
  it.each([
    [0.1, '0.1'],
    [0.1 + 0.2, '0.30000000000000004'],
    [1.5, '1.5'],
    [-1.5, '-1.5'],
    [42, '42'],
    [-0, '0'],
    [1e21, '1000000000000000000000'],
    [1.5e21, '1500000000000000000000'],
    [1e-7, '0.0000001'],
    [-1.25e-7, '-0.000000125'],
    [Number.MAX_SAFE_INTEGER, '9007199254740991'],
  ])('converts %s through its shortest round-trip string', (value, expected) => {
    expect(show(Decimal.fromNumber(value))).toBe(expected);
  });

  it('keeps the smallest subnormal number exactly as printed', () => {
    const value = Decimal.fromNumber(Number.MIN_VALUE);
    expect(value?.coefficient).toBe(5n);
    expect(value?.scale).toBe(324);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'gives undefined for %s',
    (value) => {
      expect(Decimal.fromNumber(value)).toBeUndefined();
    },
  );
});

describe('conversion to and from Integer', () => {
  // Implicit Integer → Decimal conversion: https://hl7.org/fhirpath/N1/#conversion
  it.each([
    [0, '0'],
    [1, '1'],
    [-5, '-5'],
    [2147483647, '2147483647'],
    [-2147483648, '-2147483648'],
  ])('converts the Integer %s with scale 0', (value, expected) => {
    const decimal = Decimal.fromInteger(value);
    expect(decimal.toString()).toBe(expected);
    expect(decimal.scale).toBe(0);
  });

  it.each([
    [2147483648, '2147483648'],
    [2 ** 53, '9007199254740992'],
    [-(2 ** 60), '-1152921504606846976'],
    [1e21, '1000000000000000000000'],
  ])('converts the whole number %s exactly, without a range check', (value, expected) => {
    expect(Decimal.fromInteger(value).toString()).toBe(expected);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects the non-integer %s with eval/invalid-argument',
    (value) => {
      expectInvalidArgument(() => Decimal.fromInteger(value));
    },
  );

  // Integer is 32-bit: https://hl7.org/fhirpath/N1/#integer
  it.each([
    ['0', 0],
    ['2.00', 2],
    ['-7', -7],
    ['2147483647', 2147483647],
    ['-2147483648', -2147483648],
    ['2147483648', undefined],
    ['-2147483649', undefined],
    ['1.5', undefined],
    ['-0.1', undefined],
  ])('converts %s to the Integer %s', (text, expected) => {
    expect(d(text).toInteger()).toBe(expected);
  });
});

describe('Decimal.toNumber', () => {
  it.each([
    ['1.0', 1],
    ['0.1', 0.1],
    ['-2.5', -2.5],
    ['9007199254740993', 9007199254740992], // 2^53 + 1 rounds to even
    ['1.23456789012345678901', 1.2345678901234567],
    ['0.30000000000000004', 0.30000000000000004],
  ])('converts %s to the nearest number', (text, expected) => {
    expect(d(text).toNumber()).toBe(expected);
  });
});

describe('sign and isInteger', () => {
  it.each([
    ['-0.5', -1],
    ['0.000', 0],
    ['3', 1],
  ])('the sign of %s is %s', (text, expected) => {
    expect(d(text).sign()).toBe(expected);
  });

  it.each([
    ['3', true],
    ['3.00', true],
    ['0.0', true],
    ['3.01', false],
    ['-0.5', false],
  ])('%s is whole: %s', (text, expected) => {
    expect(d(text).isInteger()).toBe(expected);
  });
});

describe('addition, subtraction and multiplication', () => {
  // https://hl7.org/fhirpath/N1/#addition, #subtraction, #multiplication
  it.each([
    ['0.1', '0.2', '0.3'], // T0004 acceptance criterion
    ['1.2', '1.8', '3.0'], // testPlus3
    ['1', '0.25', '1.25'],
    ['-1.5', '1.5', '0.0'],
    ['99999999999999999999.99999999', '0.00000001', '100000000000000000000.00000000'],
  ])('%s + %s = %s, with the larger scale', (a, b, expected) => {
    expect(show(d(a).add(d(b)))).toBe(expected);
  });

  it.each([
    ['1.8', '1.2', '0.6'], // testMinus3
    ['1', '0.25', '0.75'],
    ['0.1', '0.3', '-0.2'],
    ['5.00', '5', '0.00'],
  ])('%s - %s = %s, with the larger scale', (a, b, expected) => {
    expect(show(d(a).subtract(d(b)))).toBe(expected);
  });

  it.each([
    ['1.2', '1.8', '2.16'], // T0004 acceptance criterion, testMultiply3
    ['1.0', '1.0', '1.00'],
    ['-2', '0.5', '-1.0'],
    ['0.00000001', '0.00000001', '0.0000000000000001'],
  ])('%s * %s = %s, with the sum of the scales', (a, b, expected) => {
    expect(show(d(a).multiply(d(b)))).toBe(expected);
  });
});

describe('division', () => {
  // https://hl7.org/fhirpath/N1/#division and the HL7 testDivide group
  it.each([
    ['1', '1', '1'], // testDivide1
    ['4', '2', '2'], // testDivide2: "2 ; as a decimal value"
    ['4.0', '2.0', '2'], // testDivide3: equal to 2.0, trailing zeros removed
    ['1', '2', '0.5'], // testDivide4, T0004 acceptance criterion
    ['2', '2', '1'], // testComment6 expects the decimal 1
    ['2', '4', '0.5'], // 3.0.0 §6.6.2 example
    ['1', '3', '0.3333333333333333333333333333'], // 28 significant digits
    ['2', '3', '0.6666666666666666666666666667'], // rounded half away from zero
    ['-2', '3', '-0.6666666666666666666666666667'],
    ['2', '-3', '-0.6666666666666666666666666667'],
    ['-2', '-3', '0.6666666666666666666666666667'],
    ['1.2', '1.8', '0.6666666666666666666666666667'],
    ['10', '3', '3.333333333333333333333333333'],
    ['1', '0.0003', '3333.333333333333333333333333'],
    ['0.0', '7', '0'],
  ])('%s / %s = %s', (a, b, expected) => {
    expect(show(d(a).divide(d(b)))).toBe(expected);
  });

  it('keeps 28 significant digits for small quotients', () => {
    expect(show(d('1').divide(d('30000000000')))).toBe('0.00000000003333333333333333333333333333');
  });

  it('keeps at least 8 digits after the decimal point for large quotients', () => {
    expect(show(d('100000000000000000000000000000000').divide(d('3')))).toBe(
      '33333333333333333333333333333333.33333333',
    );
  });

  it('carries into a new digit when rounding up', () => {
    // 0.99999999999999999999999999995 / 1 rounds up to exactly 1 at 28 significant digits.
    expect(show(d('0.99999999999999999999999999995').divide(d('1')))).toBe('1');
  });

  it.each([
    ['1.2', '1.8', '2', '0.67'], // testDivide5, T0004 acceptance criterion
    ['1.2', '1.8', '0', '1'],
  ])('(%s / %s).round(%s) = %s', (a, b, precision, expected) => {
    expect(show(d(a).divide(d(b))?.round(Number(precision)))).toBe(expected);
  });

  it.each([
    ['1', '0'], // testDivide6
    ['12', '0'], // N1 §6.6.2 example
    ['0', '0'], // 3.0.0 §6.6.2 example
    ['0.0', '0'], // testDivide7
    ['1', '0.000'],
  ])('%s / %s is empty', (a, b) => {
    expect(d(a).divide(d(b))).toBeUndefined();
  });
});

describe('div and mod', () => {
  // https://hl7.org/fhirpath/N1/#div and the HL7 testDiv group
  it.each([
    ['5', '2', '2'], // N1 example, testDiv3
    ['5.5', '0.7', '7'], // N1 example
    ['1', '1', '1'], // testDiv1
    ['4', '2', '2'], // testDiv2
    ['2.2', '1.8', '1'], // testDiv4
    ['-5.5', '2', '-2'], // testDiv6: truncates towards zero
    ['5.5', '-2', '-2'],
    ['0.5', '2', '0'],
  ])('%s div %s = %s', (a, b, expected) => {
    expect(show(d(a).div(d(b)))).toBe(expected);
  });

  // https://hl7.org/fhirpath/N1/#mod and the HL7 testMod group
  it.each([
    ['5', '2', '1'], // N1 example, testMod3
    ['5.5', '0.7', '0.6'], // N1 example
    ['1', '1', '0'], // testMod1
    ['4', '2', '0'], // testMod2
    ['2.2', '1.8', '0.4'], // testMod4
    ['-5.5', '2', '-1.5'], // testMod6: the sign of the dividend
    ['5.5', '-2', '1.5'],
    ['1.50', '1', '0.50'],
  ])('%s mod %s = %s', (a, b, expected) => {
    expect(show(d(a).mod(d(b)))).toBe(expected);
  });

  it.each([
    ['5', '0'], // N1 examples, testDiv5, testMod5
    ['0', '0.0'], // testDiv7
    ['5.5', '0'], // testMod7
    ['5', '0.0'], // testMod8
    ['0.0', '0'], // testMod9
  ])('%s div %s and %s mod %s are empty', (a, b) => {
    expect(d(a).div(d(b))).toBeUndefined();
    expect(d(a).mod(d(b))).toBeUndefined();
  });
});

describe('negate and abs', () => {
  // https://hl7.org/fhirpath/N1/#abs-integer-decimal-quantity
  it.each([
    ['-5.5', '5.5'], // N1 example, testAbs2
    ['-5', '5'], // N1 example, testAbs1
    ['5.50', '5.50'],
    ['0.0', '0.0'],
  ])('abs(%s) = %s', (text, expected) => {
    expect(d(text).abs().toString()).toBe(expected);
  });

  it.each([
    ['1.50', '-1.50'],
    ['-2', '2'],
    ['0.0', '0.0'],
  ])('negate(%s) = %s', (text, expected) => {
    expect(d(text).negate().toString()).toBe(expected);
  });
});

describe('round', () => {
  // https://hl7.org/fhirpath/N1/#roundprecision-integer-decimal and
  // https://hl7.org/fhirpath/STU3/#fn-round (half away from zero for negative numbers)
  it.each([
    ['1', 0, '1'], // N1 example, testRound1
    ['3.14159', 3, '3.142'], // N1 example, testRound2
    ['-0.5', 0, '-1'], // 3.0.0, T0004 acceptance criterion
    ['0.5', 0, '1'],
    ['1.5', 0, '2'],
    ['2.5', 0, '3'],
    ['-2.5', 0, '-3'],
    ['-0.4', 0, '0'],
    ['0.49', 0, '0'],
    ['1.587', 2, '1.59'],
    ['-1.585', 2, '-1.59'],
    ['9.995', 2, '10.00'],
    ['1.5', 3, '1.5'], // never adds digits
    ['2.000', 1, '2.0'],
  ])('%s.round(%s) = %s', (text, precision, expected) => {
    expect(d(text).round(precision).toString()).toBe(expected);
  });

  it('rounds to 0 digits by default', () => {
    expect(d('2.5').round().toString()).toBe('3');
  });

  it.each([-1, 1.5, Number.NaN])(
    'rejects the precision %s with eval/invalid-argument',
    (precision) => {
      expectInvalidArgument(() => d('1.5').round(precision));
    },
  );
});

describe('truncate, floor and ceiling', () => {
  // https://hl7.org/fhirpath/N1/#truncate-integer
  it.each([
    ['101', '101'], // N1 example, testTruncate1
    ['1.00000001', '1'], // N1 example, testTruncate2
    ['-1.56', '-1'], // N1 example, testTruncate3
    ['0.9', '0'],
    ['2.00', '2'],
  ])('%s.truncate() = %s', (text, expected) => {
    expect(d(text).truncate().toString()).toBe(expected);
  });

  // https://hl7.org/fhirpath/N1/#floor-integer
  it.each([
    ['1', '1'], // N1 example, testFloor1
    ['2.1', '2'], // N1 example, testFloor2
    ['-2.1', '-3'], // N1 example, testFloor3
    ['-2.0', '-2'],
    ['0.5', '0'],
  ])('%s.floor() = %s', (text, expected) => {
    expect(d(text).floor().toString()).toBe(expected);
  });

  // https://hl7.org/fhirpath/N1/#ceiling-integer
  it.each([
    ['1', '1'], // N1 example, testCeiling1
    ['1.1', '2'], // N1 example, testCeiling3
    ['-1.1', '-1'], // N1 example, testCeiling2
    ['2.0', '2'],
    ['-0.5', '0'],
  ])('%s.ceiling() = %s', (text, expected) => {
    expect(d(text).ceiling().toString()).toBe(expected);
  });

  it('gives whole values with scale 0 that convert to Integer', () => {
    const floor = d('-2.1').floor();
    expect(floor.scale).toBe(0);
    expect(floor.toInteger()).toBe(-3);
  });
});

describe('compare and equals', () => {
  // https://hl7.org/fhirpath/N1/#comparison and the HL7 testLessThan/testGreaterThan groups
  it.each([
    ['1.0', '1.2', -1], // testLessThan2
    ['1.0', '1.0', 0], // testLessThan9
    ['1.1', '1.0', 1], // testLessThan16
    ['1', '1.000', 0],
    ['-0.1', '0', -1],
    ['-1.5', '-1.45', -1],
    ['100', '99.999', 1],
  ])('compare(%s, %s) = %s', (a, b, expected) => {
    expect(d(a).compare(d(b))).toBe(expected);
    expect(d(b).compare(d(a))).toBe(-expected || 0);
  });

  // https://hl7.org/fhirpath/N1/#equals and the HL7 testEquality group
  it.each([
    ['1.1', '1.1', true], // testEquality12
    ['1.1', '1.2', false], // testEquality13
    ['1.10', '1.1', true], // testEquality14, N1 example
    ['0.0', '0', true], // testEquality16
    ['10', '10.0', true], // testEquality33
    ['10', '1.0', false], // testEquality32
    ['100', '1.0', false], // testEquality31
    ['1.50', '1.5', true], // testEquality34
    ['-0.0', '0', true],
  ])('%s = %s is %s, ignoring trailing zeros', (a, b, expected) => {
    expect(d(a).equals(d(b))).toBe(expected);
  });
});

describe('equivalent', () => {
  // https://hl7.org/fhirpath/N1/#equivalent and the HL7 testEquivalent group
  it.each([
    ['1.1', '1.1', true], // testEquivalent8
    ['1.1', '1.2', false], // testEquivalent9
    ['1.10', '1.1', true], // testEquivalent10, N1 example
    ['0.0', '0', true], // testEquivalent13, N1 example
    ['1.0', '1', true], // testIntegerLiteralToDeciamlEquivalent
    ['1.04', '1.0', true], // trailing zeros do not count towards precision: compared at 0 digits
    ['1.5', '1', false], // 1.5 rounds to 2
    ['1.45', '1.4', false], // 1.45 rounds to 1.5
    ['-1.45', '-1.5', true], // half away from zero
    ['3.14159', '3.14', true],
    ['3.146', '3.14', false],
  ])('%s ~ %s is %s', (a, b, expected) => {
    expect(d(a).equivalent(d(b))).toBe(expected);
    expect(d(b).equivalent(d(a))).toBe(expected);
  });

  it('rounds a division result to the precision of the other operand', () => {
    const quotient = d('1.2').divide(d('1.8'));
    expect(quotient?.equivalent(d('0.67'))).toBe(true); // testEquivalent11, N1 example
    expect(quotient?.equivalent(d('0.6'))).toBe(false); // testNotEquivalent13
  });
});

describe('the size bound', () => {
  // A Decimal has at most MAX_DECIMAL_DIGITS digits and a scale of at most MAX_DECIMAL_DIGITS.
  // Results beyond it are overflow or underflow, which is empty:
  // https://hl7.org/fhirpath/STU3/#math-1
  const largest = Decimal.of(10n ** 10_000n - 1n); // 10,000 nines
  const smallest = Decimal.of(1n, 10_000); // 1e-10000

  it('is 10,000 digits', () => {
    expect(MAX_DECIMAL_DIGITS).toBe(10_000);
    expect(largest.toString()).toHaveLength(10_000);
    expect(smallest.toString()).toBe(`0.${'0'.repeat(9_999)}1`);
  });

  it('rejects values beyond it in of() with eval/invalid-argument', () => {
    expectInvalidArgument(() => Decimal.of(10n ** 10_000n));
    expectInvalidArgument(() => Decimal.of(-(10n ** 10_000n)));
    expectInvalidArgument(() => Decimal.of(1n, 10_001));
  });

  it('parses text up to it, where leading zeros do not count', () => {
    expect(Decimal.parse('9'.repeat(10_000))?.equals(largest)).toBe(true);
    expect(Decimal.parse(`000${'9'.repeat(10_000)}`)?.equals(largest)).toBe(true);
    expect(Decimal.parse(`-0.${'0'.repeat(9_999)}1`)?.equals(smallest.negate())).toBe(true);
    expect(Decimal.parse('1'.repeat(10_001))).toBeUndefined();
    expect(Decimal.parse(`0.${'0'.repeat(10_000)}1`)).toBeUndefined();
    expect(Decimal.parse(`0.${'0'.repeat(10_001)}`)).toBeUndefined(); // the scale counts for zero too
  });

  it('gives empty for sums and differences beyond it', () => {
    expect(largest.add(Decimal.ONE)).toBeUndefined();
    expect(largest.negate().subtract(Decimal.ONE)).toBeUndefined();
    expect(show(largest.add(largest.negate()))).toBe('0');
    expect(show(largest.subtract(Decimal.ONE))).toBe(`${'9'.repeat(9_999)}8`);
    // 1e9999 + 1e-10000 is exact only with 20,000 digits.
    expect(Decimal.of(10n ** 9_999n).add(smallest)).toBeUndefined();
  });

  it('gives empty for products beyond it', () => {
    expect(Decimal.of(10n ** 5_000n).multiply(Decimal.of(10n ** 5_000n))).toBeUndefined();
    expect(
      Decimal.of(10n ** 4_999n)
        .multiply(Decimal.of(10n ** 5_000n))
        ?.toString(),
    ).toHaveLength(10_000);
    expect(Decimal.of(1n, 6_000).multiply(Decimal.of(1n, 6_000))).toBeUndefined(); // scale 12,000
  });

  it('ends repeated squaring with empty instead of an error', () => {
    // From 1.1 the scale doubles with each squaring: 2, 4, …, 8,192, then 16,384.
    let value: Decimal | undefined = d('1.1');
    let squarings = 0;
    while (value !== undefined) {
      value = value.multiply(value);
      squarings += 1;
    }
    expect(squarings).toBe(14);
  });

  it('gives empty for quotients beyond it', () => {
    expect(Decimal.of(10n ** 9_999n).divide(d('0.1'))).toBeUndefined(); // 1e10000
    expect(Decimal.of(1n, 9_999).divide(Decimal.of(10n ** 9_999n))).toBeUndefined(); // 1e-19998
    expect(smallest.divide(d('2'))).toBeUndefined(); // 5e-10001
    // 1 / 3e9980 has 28 significant digits only with a scale of 10,008.
    expect(Decimal.ONE.divide(Decimal.of(3n * 10n ** 9_980n))).toBeUndefined();
    expect(Decimal.of(10n ** 9_999n).div(d('0.1'))).toBeUndefined();
  });

  it('gives empty for a large quotient whose 8 digits after the point do not fit', () => {
    // 1e9992 / 3 has 9,992 integer digits and 8 after the point: exactly 10,000 digits.
    const fits = Decimal.of(10n ** 9_992n).divide(d('3'));
    expect(fits?.scale).toBe(8);
    expect(fits?.coefficient.toString()).toHaveLength(10_000);
    // 1e9993 / 3 would need 10,001 digits.
    expect(Decimal.of(10n ** 9_993n).divide(d('3'))).toBeUndefined();
    // An exact quotient needs no digits after the point: 1e9995 / 4 = 2.5e9994.
    expect(show(Decimal.of(10n ** 9_995n).divide(d('4')))).toBe(`25${'0'.repeat(9_993)}`);
    // div has no digits after the point.
    expect(
      Decimal.of(10n ** 9_999n)
        .div(d('3'))
        ?.toString(),
    ).toBe('3'.repeat(9_999));
  });

  it('keeps an exact quotient that fits once its trailing zeros are removed', () => {
    const expected = `2${'0'.repeat(9_999)}`;
    expect(show(Decimal.of(10n ** 9_999n).divide(d('0.5')))).toBe(expected);
    expect(show(Decimal.of(10n ** 9_999n).div(d('0.5')))).toBe(expected);
  });

  it('cannot be left by mod and rounding', () => {
    expect(largest.mod(smallest)?.sign()).toBe(0);
    expect(show(Decimal.of(10n ** 10_000n - 5n, 1).round())).toBe(`1${'0'.repeat(9_999)}`);
  });
});

describe('Decimal constants', () => {
  it('provides 0 and 1 with scale 0', () => {
    expect(Decimal.ZERO.toString()).toBe('0');
    expect(Decimal.ONE.toString()).toBe('1');
  });
});
