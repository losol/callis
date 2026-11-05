import { describe, expect, it } from 'vitest';
import { stubType } from '../../test/support/stub-model.ts';
import { ModelNode } from '../model/model-node.ts';
import { DateValue } from '../values/datetime/date.ts';
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

  describe('for typed input nodes', () => {
    it('uses the same JSON mapping until model conversion exists', () => {
      const typed = new ModelNode({ value: 'male', name: 'gender', type: stubType('code') });
      expect(toSystemValue(typed)).toBe('male');
    });
  });
});
