import { describe, expect, it } from 'vitest';
import { stubModel, stubType } from '../../test/support/stub-model.ts';
import { JsonNumber } from '../model/lossless-json.ts';
import { ModelNode } from '../model/model-node.ts';
import { DateValue } from '../values/datetime/date.ts';
import { DateTimeValue } from '../values/datetime/datetime.ts';
import { TimeValue } from '../values/datetime/time.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { Quantity } from '../values/quantity/quantity.ts';
import type { Item } from './collection.ts';
import { toSystemValue } from './node-value.ts';

function node(value: unknown): ModelNode {
  return new ModelNode({ value, name: 'element' });
}

function decimalText(item: Item | undefined): string | undefined {
  return item instanceof Decimal ? item.toString() : undefined;
}

// Model-less JSON values map to System types:
// https://github.com/losol/callis/blob/main/docs/tasks/T0003-types-and-collections.md#model-principles
describe('toSystemValue', () => {
  describe('for items that are not input nodes', () => {
    it.each<[string, Item]>([
      ['a Boolean', true],
      ['a String', 'text'],
      ['an Integer', 5],
      ['a Decimal', Decimal.ONE],
      ['a Quantity', new Quantity(Decimal.ONE, 'mg')],
    ])('returns %s unchanged', (_label, item) => {
      expect(toSystemValue(item)).toBe(item);
    });

    it('returns a Date unchanged', () => {
      const date = DateValue.tryCreate({ year: 2020 });
      expect(date).toBeInstanceOf(DateValue);
      if (date !== undefined) {
        expect(toSystemValue(date)).toBe(date);
      }
    });
  });

  describe('for model-less input nodes', () => {
    it('gives a JSON string as a String', () => {
      expect(toSystemValue(node('female'))).toBe('female');
    });

    it('keeps a string that looks like a date as a String', () => {
      expect(toSystemValue(node('1974-12-25'))).toBe('1974-12-25');
    });

    it.each([true, false])('gives the JSON boolean %s as a Boolean', (value) => {
      expect(toSystemValue(node(value))).toBe(value);
    });

    // https://hl7.org/fhirpath/N1/#literals: Integer is a 32-bit signed integer.
    it.each([0, 1, -1, 2 ** 31 - 1, -(2 ** 31)])(
      'gives the whole number %s as an Integer',
      (value) => {
        expect(toSystemValue(node(value))).toBe(value);
      },
    );

    it('turns a negative zero into the Integer 0', () => {
      expect(Object.is(toSystemValue(node(-0)), 0)).toBe(true);
    });

    it.each<[number, string]>([
      [1.5, '1.5'],
      [0.1, '0.1'],
      [-2.25, '-2.25'],
      [2 ** 31, '2147483648'],
      [-(2 ** 31) - 1, '-2147483649'],
    ])(
      'gives the number %s outside the Integer range or with a fraction as a Decimal',
      (value, text) => {
        expect(decimalText(toSystemValue(node(value)))).toBe(text);
      },
    );

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      'gives no value for the non-finite number %s',
      (value) => {
        expect(toSystemValue(node(value))).toBeUndefined();
      },
    );

    it('keeps a node with an object value, so complex values compare as nodes', () => {
      const patient = node({ resourceType: 'Patient' });
      expect(toSystemValue(patient)).toBe(patient);
    });

    it('gives no value for a primitive that only has extensions', () => {
      const extensionOnly = new ModelNode({
        value: undefined,
        name: 'birthDate',
        primitiveElement: { extension: [] },
      });
      expect(toSystemValue(extensionOnly)).toBeUndefined();
    });

    it('gives no value for a null value', () => {
      expect(toSystemValue(node(null))).toBeUndefined();
    });

    it('does not change the node', () => {
      const given = node('Peter');
      toSystemValue(given);
      expect(given.value).toBe('Peter');
      expect(given.type).toBeUndefined();
    });
  });

  describe('for lossless JSON numbers in model-less input nodes', () => {
    it.each<[string, number]>([
      ['185', 185],
      ['-0', 0],
      ['2147483647', 2 ** 31 - 1],
    ])('gives the whole number %s as an Integer', (text, expected) => {
      expect(toSystemValue(node(new JsonNumber(text)))).toBe(expected);
    });

    it.each(['1.50', '1.0', '2147483648', '9.5e2'])(
      'gives %s, with a fraction, an exponent or outside the Integer range, as a Decimal',
      (text) => {
        expect(decimalText(toSystemValue(node(new JsonNumber(text))))).toBe(
          new JsonNumber(text).toDecimal()?.toString(),
        );
      },
    );

    it('keeps the precision of the text', () => {
      expect(decimalText(toSystemValue(node(new JsonNumber('1.50'))))).toBe('1.50');
    });
  });

  // https://hl7.org/fhir/R5/fhirpath.html#types: FHIR primitives convert by their System type.
  describe('for typed input nodes', () => {
    function typed(typeName: string, value: unknown): ModelNode {
      const type = stubType(typeName);
      return new ModelNode({
        value,
        name: 'element',
        type,
        systemType: stubModel.getSystemType(type),
      });
    }

    it('gives a FHIR boolean, string and code as System values', () => {
      expect(toSystemValue(typed('boolean', true))).toBe(true);
      expect(toSystemValue(typed('string', 'Peter'))).toBe('Peter');
      expect(toSystemValue(typed('code', 'male'))).toBe('male');
    });

    it('gives a FHIR integer as an Integer, also from a lossless number', () => {
      expect(toSystemValue(typed('integer', 5))).toBe(5);
      expect(toSystemValue(typed('integer', new JsonNumber('5')))).toBe(5);
    });

    it('gives a FHIR decimal as a Decimal, even for a whole number', () => {
      expect(decimalText(toSystemValue(typed('decimal', 185)))).toBe('185');
      expect(decimalText(toSystemValue(typed('decimal', 1.5)))).toBe('1.5');
      expect(decimalText(toSystemValue(typed('decimal', new JsonNumber('1.50'))))).toBe('1.50');
      expect(decimalText(toSystemValue(typed('decimal', new JsonNumber('185'))))).toBe('185');
    });

    it('gives a FHIR integer64 as a Long from the JSON string R5 uses', () => {
      expect(toSystemValue(typed('integer64', '9007199254740993'))).toBe(9007199254740993n);
      expect(toSystemValue(typed('integer64', 12))).toBe(12n);
      expect(toSystemValue(typed('integer64', new JsonNumber('12')))).toBe(12n);
    });

    // docs/spec-notes.md#fhirdate-maps-to-systemdate
    it('gives a FHIR date as a Date, not a DateTime, at the precision written', () => {
      const date = toSystemValue(typed('date', '1974-12-25'));
      expect(date).toBeInstanceOf(DateValue);
      expect(String(date)).toBe('1974-12-25');
      expect(String(toSystemValue(typed('date', '1974')))).toBe('1974');
    });

    it('gives a FHIR dateTime and instant as a DateTime, and a time as a Time', () => {
      const dateTime = toSystemValue(typed('dateTime', '2016-03-28T10:30:00+01:00'));
      expect(dateTime).toBeInstanceOf(DateTimeValue);
      expect(String(dateTime)).toBe('2016-03-28T10:30:00+01:00');
      expect(toSystemValue(typed('dateTime', '2016-03'))).toBeInstanceOf(DateTimeValue);
      expect(toSystemValue(typed('instant', '2016-03-28T10:30:00Z'))).toBeInstanceOf(DateTimeValue);
      const time = toSystemValue(typed('time', '10:30:00'));
      expect(time).toBeInstanceOf(TimeValue);
      expect(String(time)).toBe('10:30:00');
    });

    // https://hl7.org/fhir/R5/fhirpath.html#quantity
    it('gives a FHIR Quantity with a UCUM code as a Quantity, keeping lossless values', () => {
      const ucum = 'http://unitsofmeasure.org';
      const weight = toSystemValue(
        typed('Quantity', { value: 185, unit: 'lbs', system: ucum, code: '[lb_av]' }),
      );
      expect(weight).toBeInstanceOf(Quantity);
      expect(String(weight)).toBe("185 '[lb_av]'");
      const exact = toSystemValue(
        typed('Quantity', { value: new JsonNumber('1.50'), system: ucum, code: 'mg' }),
      );
      expect(String(exact)).toBe("1.50 'mg'");
      const age = toSystemValue(typed('Age', { value: 41, system: ucum, code: 'a' }));
      expect(String(age)).toBe('41 year');
    });

    it('keeps a FHIR Quantity without a UCUM code as a complex value', () => {
      const quantity = typed('Quantity', { value: 185, unit: 'lbs' });
      expect(toSystemValue(quantity)).toBe(quantity);
    });

    it('keeps a complex value as the node itself', () => {
      const name = typed('HumanName', { family: 'Chalmers' });
      expect(toSystemValue(name)).toBe(name);
    });

    // docs/spec-notes.md#typed-primitives-that-do-not-parse
    it.each<[string, unknown, unknown]>([
      ['boolean', 'true', 'true'],
      ['string', 5, 5],
      ['integer', 1.5, Decimal.parse('1.5')],
      ['integer', 'x', 'x'],
      ['date', 'not a date', 'not a date'],
      ['date', '1974-12-25T10:00', '1974-12-25T10:00'],
      ['dateTime', '10:00', '10:00'],
      ['time', '2016-03-28', '2016-03-28'],
      ['decimal', true, true],
    ])(
      'keeps the plain JSON mapping for a %s whose value %j is not valid',
      (typeName, value, expected) => {
        expect(toSystemValue(typed(typeName, value))).toEqual(expected);
      },
    );

    it('gives no value for a typed primitive that only has extensions', () => {
      const type = stubType('date');
      const extensionOnly = new ModelNode({
        value: undefined,
        name: 'birthDate',
        type,
        systemType: 'Date',
        primitiveElement: { extension: [] },
      });
      expect(toSystemValue(extensionOnly)).toBeUndefined();
    });

    it('converts once and remembers the value', () => {
      const birthDate = typed('date', '1974-12-25');
      const first = toSystemValue(birthDate);
      expect(toSystemValue(birthDate)).toBe(first);
      expect(birthDate.systemValue()).toBe(first);
      expect(birthDate.value).toBe('1974-12-25');
    });
  });
});
