// The Quantity kernels are internal to @callis/core until T0025, so these cross-package tests
// import them from its source.
import { Decimal, minimalUnitSystem, type UnitConversionOptions } from '@callis/core';
import { describe, expect, it } from 'vitest';
import {
  addQuantity,
  compareQuantity,
  convertQuantity,
  divideQuantity,
  multiplyQuantity,
  quantityEquals,
  quantityEquivalent,
  subtractQuantity,
} from '../../core/src/values/quantity/operations.ts';
import { Quantity } from '../../core/src/values/quantity/quantity.ts';
import { readEssence } from '../src/essence/essence-reader.ts';
import { UCUM_ESSENCE_XML } from '../src/essence/ucum-essence-xml.ts';
import { ucum } from '../src/index.ts';
import { compare as compareRational, divide, multiply, type Rational } from '../src/rational.ts';
import { resolveUnit } from '../src/resolve-unit.ts';
import { buildUnitTable, EMPTY_UNIT_LOOKUP } from '../src/unit-table.ts';

function decimal(text: string): Decimal {
  const value = Decimal.parse(text);
  if (value === undefined) throw new Error(`invalid Decimal ${text}`);
  return value;
}

const q = (value: string, unit: string): Quantity => new Quantity(decimal(value), unit);
const text = (quantity: Quantity | undefined): string | undefined => quantity?.toString();

describe('T0007 acceptance criteria', () => {
  it("1 'kg' = 1000 'g'", () => {
    expect(quantityEquals(q('1', 'kg'), q('1000', 'g'), ucum)).toBe(true);
  });

  it("1 'cm' < 1 'm'", () => {
    expect(compareQuantity(q('1', 'cm'), q('1', 'm'), ucum)).toBe(-1);
  });

  it("12 'cm2' / 3 'cm' = 4.0 'cm'", () => {
    const quotient = divideQuantity(q('12', 'cm2'), q('3', 'cm'), ucum);
    expect(text(quotient)).toBe("4 'cm'");
    expect(quotient && quantityEquals(quotient, q('4.0', 'cm'), ucum)).toBe(true);
  });

  it("1 'mg/dL' converts to 'g/L'", () => {
    expect(text(convertQuantity(q('1', 'mg/dL'), 'g/L', ucum))).toBe("0.01 'g/L'");
  });

  it("100 'Cel' > 50 '[degF]'", () => {
    expect(compareQuantity(q('100', 'Cel'), q('50', '[degF]'), ucum)).toBe(1);
  });

  it.each(['xyz', 'm//s', 'kg ', 'µg', '[degF', 'g{', '(m', 'k', 'k[in_i]'])(
    'returns undefined for the invalid unit %j instead of throwing',
    (unit) => {
      expect(ucum.parse(unit)).toBeUndefined();
      expect(ucum.convert(Decimal.ONE, unit, 'g')).toBeUndefined();
      expect(ucum.convert(Decimal.ONE, 'g', unit)).toBeUndefined();
      expect(ucum.compare?.(Decimal.ONE, unit, Decimal.ONE, 'g')).toBeUndefined();
      expect(ucum.multiply(unit, 'g')).toBeUndefined();
      expect(ucum.divide('g', unit)).toBeUndefined();
      expect(quantityEquals(q('1', unit), q('1', 'g'), ucum)).toBeUndefined();
      expect(quantityEquivalent(q('1', unit), q('1', 'g'), ucum)).toBe(false);
    },
  );
});

// The R5 suite's testQuantity group (tools/conformance/fixtures/r5/tests-fhir-r5.xml).
describe('HL7 testQuantity', () => {
  it.each([
    ['testQuantity1', () => quantityEquals(q('4.0000', 'g'), q('4000.0', 'mg'), ucum), true],
    ['testQuantity2', () => quantityEquivalent(q('4', 'g'), q('4000', 'mg'), ucum), true],
    ['testQuantity3', () => quantityEquals(q('4', 'g'), q('4040', 'mg'), ucum), false],
    ['testQuantity4', () => quantityEquivalent(q('4', 'g'), q('4040', 'mg'), ucum), true],
    ['testQuantity5', () => quantityEquals(q('7', 'days'), q('1', 'week'), ucum), true],
    ['testQuantity6', () => quantityEquals(q('7', 'days'), q('1', 'wk'), ucum), true],
    ['testQuantity7', () => compareQuantity(q('6', 'days'), q('1', 'week'), ucum) === -1, true],
    ['testQuantity8', () => compareQuantity(q('8', 'days'), q('1', 'week'), ucum) === 1, true],
    [
      'testQuantity9',
      () => equalsResult(multiplyQuantity(q('2.0', 'cm'), q('2.0', 'm'), ucum), q('0.040', 'm2')),
      true,
    ],
    [
      'testQuantity10',
      () => equalsResult(divideQuantity(q('4.0', 'g'), q('2.0', 'm'), ucum), q('2', 'g/m')),
      true,
    ],
    [
      'testQuantity11',
      () => equalsResult(divideQuantity(q('1.0', 'm'), q('1.0', 'm'), ucum), q('1', '1')),
      true,
    ],
  ])('%s', (_, evaluate, expected) => {
    expect(evaluate()).toBe(expected);
  });
});

function equalsResult(result: Quantity | undefined, expected: Quantity): boolean | undefined {
  return result === undefined ? undefined : quantityEquals(result, expected, ucum);
}

describe('FHIRPath 3.0.0 examples', () => {
  // https://hl7.org/fhirpath/STU3/en/index.html#quantity-equality
  it.each([
    ["1 'cm' = 10.0 'mm'", q('1', 'cm'), q('10.0', 'mm'), true],
    ["1 'cm' = 1 'm'", q('1', 'cm'), q('1', 'm'), false],
    ["1 'cm' = 1 's'", q('1', 'cm'), q('1', 's'), undefined],
    ["23 'Cel' = 73.4 '[degF]'", q('23', 'Cel'), q('73.4', '[degF]'), true],
  ])('%s', (_, a, b, expected) => {
    expect(quantityEquals(a, b, ucum)).toBe(expected);
    expect(quantityEquals(b, a, ucum)).toBe(expected);
  });

  // https://hl7.org/fhirpath/STU3/en/index.html#quantity-equivalence
  it.each([
    ["2.1 'cm' ~ 21 'mm'", q('2.1', 'cm'), q('21', 'mm')],
    ["21 'mm' ~ 2 'cm'", q('21', 'mm'), q('2', 'cm')],
    ["4 'g' ~ 4040 'mg'", q('4', 'g'), q('4040', 'mg')],
    ["1 '[in_i]' ~ 2.5 'cm'", q('1', '[in_i]'), q('2.5', 'cm')],
    ["23 'Cel' ~ 73.4 '[degF]'", q('23', 'Cel'), q('73.4', '[degF]')],
    ["1 year ~ 1 'a'", q('1', 'year'), q('1', 'a')],
    ["1 year ~ 12 'mo'", q('1', 'year'), q('12', 'mo')],
    ['1 year ~ 11 months', q('1', 'year'), q('11', 'months')],
    ["1 second ~ 1 's'", q('1', 'second'), q('1', 's')],
  ])('%s', (_, a, b) => {
    expect(quantityEquivalent(a, b, ucum)).toBe(true);
  });

  // https://hl7.org/fhirpath/STU3/en/index.html#addition
  it('adds in the most granular unit', () => {
    expect(text(addQuantity(q('3', 'm'), q('3', 'cm'), ucum))).toBe("303 'cm'");
    expect(text(addQuantity(q('3', 'cm'), q('3', 'm'), ucum))).toBe("303 'cm'");
    const sum = addQuantity(q('3', 'm'), q('3', 'cm'), ucum);
    expect(text(sum && convertQuantity(sum, 'm', ucum))).toBe("3.03 'm'");
    expect(addQuantity(q('2', '1'), q('2', 'cm'), ucum)).toBeUndefined();
    expect(text(addQuantity(q('2', '1'), q('2', '1'), ucum))).toBe("4 '1'");
    expect(text(subtractQuantity(q('1', 'kg'), q('1', 'g'), ucum))).toBe("999 'g'");
  });

  // https://hl7.org/fhirpath/STU3/en/index.html#multiplication
  it.each([
    ["12 'cm' * 3 'cm'", q('12', 'cm'), q('3', 'cm'), "36 'cm2'"],
    ["3 'cm' * 12 'cm2'", q('3', 'cm'), q('12', 'cm2'), "36 'cm3'"],
    ["10 'm/s' * 10 's'", q('10', 'm/s'), q('10', 's'), "100 'm'"],
    ["3 * 2 'cm'", q('3', '1'), q('2', 'cm'), "6 'cm'"],
    ["42 * 1 'm'", q('42', '1'), q('1', 'm'), "42 'm'"],
    ["12 day * 45 'm'", q('12', 'day'), q('45', 'm'), undefined],
  ])('%s', (_, a, b, expected) => {
    expect(text(multiplyQuantity(a, b, ucum))).toBe(expected);
  });

  // https://hl7.org/fhirpath/STU3/en/index.html#division
  it.each([
    ["12 'cm2' / 3 'cm'", q('12', 'cm2'), q('3', 'cm'), "4 'cm'"],
    ["120 'm' / 60 's'", q('120', 'm'), q('60', 's'), "2 'm/s'"],
    ["60 / 1 's'", q('60', '1'), q('1', 's'), "60 '/s'"],
    ["60 's' / 2", q('60', 's'), q('2', '1'), "30 's'"],
    ['km / h', q('1', 'km'), q('1', 'h'), "1 'km/h'"],
  ])('%s', (_, a, b, expected) => {
    expect(text(divideQuantity(a, b, ucum))).toBe(expected);
  });
});

describe('unit conversion', () => {
  it.each([
    ['1', '[in_i]', 'cm', '2.54'],
    ['1', '[lb_av]', 'kg', '0.45359237'],
    ['1', 'mm[Hg]', 'kPa', '0.133322'],
    ['1', 'L', 'mL', '1000'],
    ['1', '10*3/uL', '10*9/L', '1'],
    ['1', '10^3', '1', '1000'],
    ['5', '%', '1', '0.05'],
    ['1.0', 'm', 'cm', '100.0'],
    ['1.25', 'cm', 'm', '0.0125'],
    ['37', 'Cel', '[degF]', '98.6'],
    ['98.6', '[degF]', 'Cel', '37.0'],
    ['0', 'Cel', 'K', '273.15'],
    ['212', '[degF]', 'K', '373.15'],
    ['0', 'K', 'Cel', '-273.15'],
    ['100', '[degF]', 'Cel', '37.77777777777777777777777778'],
    ['1', 'mg{total}/dL', 'g/L', '0.01'],
    ['1', '[ft_i]', '[yd_i]', '0.3333333333333333333333333333'],
  ])('%s %s is %s %s', (value, from, to, expected) => {
    expect(ucum.convert(decimal(value), from, to)?.toString()).toBe(expected);
  });

  it('compares recurring ratios exactly', () => {
    const third = ucum.convert(Decimal.ONE, '[ft_i]', '[yd_i]');
    expect(third).toBeDefined();
    if (third === undefined) return;
    expect(compareQuantity(q('1', '[ft_i]'), new Quantity(third, '[yd_i]'), ucum)).toBe(1);
    expect(compareQuantity(new Quantity(third, '[yd_i]'), q('1', '[ft_i]'), ucum)).toBe(-1);
    expect(ucum.compare?.(Decimal.ONE, '[yd_i]', decimal('3'), '[ft_i]')).toBe(0);
  });

  it('does not relate units of different dimensions', () => {
    expect(ucum.convert(Decimal.ONE, 'g', 'm')).toBeUndefined();
    expect(ucum.convert(Decimal.ONE, 'Cel', 'm')).toBeUndefined();
    expect(ucum.convert(Decimal.ONE, '1', 'g')).toBeUndefined();
  });

  it('returns undefined when the result leaves the Decimal size bound', () => {
    const huge = Decimal.of(10n ** 9999n);
    expect(ucum.convert(huge, 'Gm', 'nm')).toBeUndefined();
    expect(ucum.convert(huge, 'nm', 'Gm')?.toString()).toBe(`1${'0'.repeat(9981)}`);
  });

  it('only matches arbitrary units with the identical unit (UCUM §24, §25)', () => {
    expect(quantityEquals(q('1', '[iU]'), q('1', '[iU]'), ucum)).toBe(true);
    expect(quantityEquals(q('1', '[iU]'), q('1', '[IU]'), ucum)).toBeUndefined();
    expect(quantityEquals(q('1', '[iU]/mL'), q('1000', '[iU]/L'), ucum)).toBeUndefined();
    expect(quantityEquals(q('1', '[iU]'), q('1', '1'), ucum)).toBeUndefined();
    expect(quantityEquivalent(q('1', "[arb'U]"), q('1', '%'), ucum)).toBe(false);
    expect(text(multiplyQuantity(q('2', '[iU]/mL'), q('3', 'mL'), ucum))).toBe("6 '[iU]'");
  });

  it('does not convert special units other than Cel and [degF]', () => {
    expect(ucum.parse('[pH]')?.unit).toBe('[pH]');
    expect(ucum.convert(Decimal.ONE, '[pH]', 'mol/L')).toBeUndefined();
    expect(ucum.convert(Decimal.ONE, 'mCel', 'K')).toBeUndefined();
    expect(ucum.convert(Decimal.ONE, 'Cel/s', 'K/s')).toBeUndefined();
    expect(quantityEquals(q('1', '[pH]'), q('1', '[pH]'), ucum)).toBe(true);
  });
});

describe('unit algebra', () => {
  it.each([
    ['cm', '/', 'm', "0.01 '1'"],
    ['s', '/', 'min', "0.01666666666666666666666666667 '1'"],
    ['60 s', '/', 'min', "1 '1'"],
    ['mg/dL', '*', 'dL', "1 'mg'"],
    ['J/kg', '*', 'g', "0.001 'J'"],
    ['m/s', '*', 'min', "60 'm'"],
    ['10*3/uL', '*', 'uL', "1 '10*3'"],
    ['10*3', '*', '10*6', "1 '10*9'"],
    ['10.m', '*', 'm', "10 'm2'"],
    ['{RBC}/uL', '*', 'uL', "1 '1'"],
    ['%', '*', '%', "1 '%2'"],
    ['%', '/', '[ppm]', "1 '%/[ppm]'"],
    ['1', '/', 'mL/min', "1 'min/mL'"],
    ['xyz', '*', '1', "1 'xyz'"],
    ['xyz', '/', 'xyz', "1 '1'"],
    ['Cel', '*', '1', undefined],
    ['1', '*', 'Cel', undefined],
    ['Cel', '/', 'Cel', undefined],
    ['[pH]', '/', '1', undefined],
    ['xyz', '*', 'g', undefined],
  ])('%s %s %s', (a, operator, b, expected) => {
    const [value = '1', unit = a] = a.includes(' ') ? a.split(' ') : ['1', a];
    const left = q(value, unit);
    const right = q('1', b);
    const result =
      operator === '*' ? multiplyQuantity(left, right, ucum) : divideQuantity(left, right, ucum);
    expect(text(result)).toBe(expected);
  });

  it('converts a commensurable unit into the earlier one, keeping every digit', () => {
    expect(text(multiplyQuantity(q('2.0', 'cm'), q('2.0', 'm'), ucum))).toBe("400.00 'cm2'");
    expect(text(multiplyQuantity(q('2.0', 'm'), q('2.0', 'cm'), ucum))).toBe("0.0400 'm2'");
  });

  const essence = readEssence(UCUM_ESSENCE_XML);
  const lookup = essence === undefined ? EMPTY_UNIT_LOOKUP : buildUnitTable(essence);
  const UNITS = [
    '1',
    'm',
    'cm',
    'km',
    'cm2',
    'm/s',
    's',
    'min',
    'h',
    'g',
    'mg',
    'kg',
    'mg/dL',
    'g/L',
    'L',
    'mL',
    'dL',
    'mol/L',
    '[in_i]',
    '[ft_i]2',
    'N',
    'J',
    'kg.m/s2',
    '10*3/uL',
    '%',
    '{RBC}',
    '[iU]/mL',
    '/s',
  ];

  it('returns units whose magnitude times the scale equals the exact product or quotient', () => {
    const magnitude = (unit: string): Rational => {
      const resolved = resolveUnit(unit, lookup);
      if (resolved === undefined) throw new Error(`unknown unit ${unit}`);
      return resolved.magnitude;
    };
    for (const a of UNITS) {
      for (const b of UNITS) {
        for (const operation of ['multiply', 'divide'] as const) {
          const product = ucum[operation](a, b);
          expect(product, `${a} ${operation} ${b}`).toBeDefined();
          if (product === undefined) continue;
          const expected =
            operation === 'multiply'
              ? multiply(magnitude(a), magnitude(b))
              : divide(magnitude(a), magnitude(b));
          const scale = divide(
            {
              numerator: product.factor.coefficient,
              denominator: 10n ** BigInt(product.factor.scale),
            },
            {
              numerator: product.divisor?.coefficient ?? 1n,
              denominator: 10n ** BigInt(product.divisor?.scale ?? 0),
            },
          );
          const actual = scale && multiply(magnitude(product.unit), scale);
          expect(
            actual && expected && compareRational(actual, expected),
            `${a} ${operation} ${b}`,
          ).toBe(0);
          expect(ucum.parse(product.unit), product.unit).toBeDefined();
        }
      }
    }
  });
});

describe('calendar keywords', () => {
  const MINIMAL_UNITS = [
    '1',
    'year',
    'years',
    'month',
    'week',
    'weeks',
    'day',
    'hour',
    'minute',
    'second',
    'millisecond',
    'a',
    'mo',
    'wk',
    'd',
    'h',
    'min',
    's',
    'ms',
  ];
  const CALENDAR_KEYWORDS: ReadonlySet<string> = new Set([
    'year',
    'years',
    'month',
    'week',
    'weeks',
    'day',
    'hour',
    'minute',
    'second',
    'millisecond',
  ]);
  const OPTIONS: readonly (UnitConversionOptions | undefined)[] = [
    undefined,
    { equivalence: true },
    { explicit: true },
  ];
  const show = (value: unknown): unknown =>
    value instanceof Decimal
      ? value.toString()
      : JSON.parse(JSON.stringify(value ?? null, decimals));
  function decimals(_: string, value: unknown): unknown {
    return value instanceof Decimal ? value.toString() : value;
  }

  it('behave exactly as in the minimal unit system', () => {
    const value = decimal('1.5');
    for (const a of MINIMAL_UNITS) {
      for (const b of MINIMAL_UNITS) {
        for (const options of OPTIONS) {
          expect(show(ucum.convert(value, a, b, options)), `${a} → ${b}`).toEqual(
            show(minimalUnitSystem.convert(value, a, b, options)),
          );
        }
        expect(ucum.compare?.(value, a, Decimal.ONE, b), `${a} ? ${b}`).toBe(
          minimalUnitSystem.compare?.(value, a, Decimal.ONE, b),
        );
      }
    }
  });

  it('keep the products and quotients of the minimal unit system', () => {
    const left = decimal('1.50');
    const right = decimal('4');
    for (const a of MINIMAL_UNITS) {
      for (const b of MINIMAL_UNITS) {
        if (CALENDAR_KEYWORDS.has(a) || CALENDAR_KEYWORDS.has(b)) {
          // Calendar units only combine with '1', exactly as in core.
          expect(show(ucum.multiply(a, b)), `${a} * ${b}`).toEqual(
            show(minimalUnitSystem.multiply(a, b)),
          );
          expect(show(ucum.divide(a, b)), `${a} / ${b}`).toEqual(
            show(minimalUnitSystem.divide(a, b)),
          );
          continue;
        }
        // UCUM time units may also give units the minimal system lacks, such as '/a' or 's2'.
        for (const operation of [multiplyQuantity, divideQuantity]) {
          const minimal = operation(new Quantity(left, a), new Quantity(right, b));
          if (minimal === undefined) continue;
          expect(text(operation(new Quantity(left, a), new Quantity(right, b), ucum))).toBe(
            text(minimal),
          );
        }
      }
    }
  });

  it('relate week to millisecond to other UCUM time units, but year and month only by equivalence', () => {
    expect(quantityEquals(q('1', 'week'), q('604800000000', 'us'), ucum)).toBe(true);
    expect(quantityEquals(q('1', 'year'), q('31557600000000', 'us'), ucum)).toBeUndefined();
    expect(quantityEquivalent(q('1', 'year'), q('31557600000000', 'us'), ucum)).toBe(true);
    expect(quantityEquals(q('1', 'month'), q('1', 'mo_j'), ucum)).toBeUndefined();
    expect(quantityEquivalent(q('1', 'month'), q('1', 'mo_j'), ucum)).toBe(true);
    expect(compareQuantity(q('1', 'year'), q('1', 'a_g'), ucum)).toBeUndefined();
    expect(quantityEquals(q('1', 'a'), q('1', 'a_j'), ucum)).toBe(true);
    expect(quantityEquals(q('1', 'mo'), q('1', 'mo_g'), ucum)).toBe(false);
  });

  it('convert explicitly within the source system before relabeling', () => {
    expect(text(convertQuantity(q('1', 'a_j'), 'year', ucum))).toBe('1 year');
    expect(text(convertQuantity(q('1', 'week'), 'us', ucum))).toBe("604800000000 'us'");
    expect(convertQuantity(q('1', 'year'), 'a_j', ucum)).toBeUndefined();
  });

  it('only multiply and divide with the unity', () => {
    expect(text(multiplyQuantity(q('2', 'week'), q('3', '1'), ucum))).toBe('6 week');
    expect(text(divideQuantity(q('6', 'weeks'), q('3', '1'), ucum))).toBe('2 week');
    expect(multiplyQuantity(q('2', 'week'), q('3', 'm'), ucum)).toBeUndefined();
    expect(divideQuantity(q('2', 'week'), q('1', 'week'), ucum)).toBeUndefined();
    expect(divideQuantity(q('1', 'm'), q('1', 'second'), ucum)).toBeUndefined();
  });

  it('parse as the minimal unit system does', () => {
    expect(ucum.parse('weeks')?.unit).toBe('week');
    expect(ucum.parse('mg/dL')?.unit).toBe('mg/dL');
    expect(ucum.parse('Weeks')).toBeUndefined();
  });
});
