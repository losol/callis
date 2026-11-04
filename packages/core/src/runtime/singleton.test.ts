import { describe, expect, expectTypeOf, it } from 'vitest';
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { ModelNode } from '../model/model-node.ts';
import type { SystemTypeName } from '../types/system-types.ts';
import type { Collection, Item } from './collection.ts';
import { type ItemConversion, singleton } from './singleton.ts';

// Test conversions for JavaScript primitives. The real ones (T0008, T0018) also convert value
// classes and model nodes.
const toBoolean: ItemConversion<boolean> = (item) => (typeof item === 'boolean' ? item : undefined);
const toInteger: ItemConversion<number> = (item) =>
  typeof item === 'number' && Number.isInteger(item) ? item : undefined;
const toText: ItemConversion<string> = (item) => (typeof item === 'string' ? item : undefined);

/** Stands in for an implicit conversion, Integer → Decimal, with the Decimal as a string. */
const toDecimalText: ItemConversion<string> = (item) =>
  typeof item === 'number' ? item.toFixed(1) : undefined;

function expectSingletonError(evaluate: () => unknown): void {
  let caught: unknown;
  try {
    evaluate();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(FhirPathEvaluationError);
  expect(caught).toMatchObject({ code: 'eval/singleton-expected' });
}

// https://hl7.org/fhirpath/N1/#singleton-evaluation-of-collections
describe('singleton', () => {
  describe('1. a single item that converts to the expected type', () => {
    it.each<[string, Collection, unknown]>([
      ['an Integer', [5], 5],
      ['a zero', [0], 0],
    ])('gives the value of %s', (_label, collection, expected) => {
      expect(singleton(collection, 'Integer', toInteger)).toBe(expected);
    });

    it('gives the converted value after an implicit conversion', () => {
      expect(singleton([2], 'Decimal', toDecimalText)).toBe('2.0');
    });

    it('gives an empty string, which is a value and not empty', () => {
      expect(singleton([''], 'String', toText)).toBe('');
    });

    it.each([[true], [false]])('gives the Boolean %s where a Boolean is expected', (value) => {
      // Step 1 comes before step 2: a single false stays false.
      expect(singleton([value], 'Boolean', toBoolean)).toBe(value);
    });

    it('passes the item to the conversion', () => {
      const seen: Item[] = [];
      const item = { resourceType: 'Patient' };
      singleton([item], 'Any', (value) => {
        seen.push(value);
        return value;
      });
      expect(seen).toEqual([item]);
    });
  });

  describe('2. a single item where a Boolean is expected', () => {
    it.each<[string, Item]>([
      ['a complex value', new ModelNode({ value: { family: 'Chalmers' }, name: 'name' })],
      ['a string', 'false'],
      ['an Integer', 0],
    ])('gives true for %s that does not convert', (_label, item) => {
      // `Patient.active and Patient.gender and Patient.telecom` is true for one telecom.
      expect(singleton([item], 'Boolean', toBoolean)).toBe(true);
    });
  });

  describe('3. an empty collection', () => {
    it('stays empty where a Boolean is expected', () => {
      expect(singleton([], 'Boolean', toBoolean)).toBeUndefined();
    });

    it('stays empty where another type is expected', () => {
      expect(singleton([], 'Integer', toInteger)).toBeUndefined();
    });

    it('does not call the conversion', () => {
      let calls = 0;
      singleton([], 'String', () => {
        calls++;
        return 'x';
      });
      expect(calls).toBe(0);
    });
  });

  describe('4. anything else raises eval/singleton-expected', () => {
    it('for more than one item where a Boolean is expected', () => {
      // `Patient.active and Patient.telecom` with several telecoms is an error.
      expectSingletonError(() => singleton([true, true], 'Boolean', toBoolean));
    });

    it('for more than one item where another type is expected', () => {
      expectSingletonError(() => singleton([1, 2, 3], 'Integer', toInteger));
    });

    it('for more than one item even when each would convert', () => {
      expectSingletonError(() => singleton(['a', 'b'], 'String', toText));
    });

    it('for a single item that does not convert to a type other than Boolean', () => {
      expectSingletonError(() => singleton(['5'], 'Integer', toInteger));
      expectSingletonError(() => singleton([true], 'String', toText));
    });
  });

  it('types the result by the expected type', () => {
    const collection: Collection = [];
    const expectedType = ((): SystemTypeName => 'Integer')();
    expectTypeOf(singleton(collection, 'Boolean', toBoolean)).toEqualTypeOf<boolean | undefined>();
    expectTypeOf(singleton(collection, 'Integer', toInteger)).toEqualTypeOf<number | undefined>();
    // With an expected type known only at runtime, step 2 may give true.
    expectTypeOf(singleton(collection, expectedType, toInteger)).toEqualTypeOf<
      number | true | undefined
    >();
  });
});
