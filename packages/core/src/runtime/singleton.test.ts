import { describe, expect, expectTypeOf, it } from 'vitest';
import type { EvaluationErrorCode } from '../errors/error-codes.ts';
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

function expectEvaluationError(evaluate: () => unknown, code: EvaluationErrorCode): void {
  let caught: unknown;
  try {
    evaluate();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(FhirPathEvaluationError);
  expect(caught).toMatchObject({ code });
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

  describe('4. anything else is an error', () => {
    it('raises eval/singleton-expected for more than one item where a Boolean is expected', () => {
      // `Patient.active and Patient.telecom` with several telecoms is an error.
      expectEvaluationError(
        () => singleton([true, true], 'Boolean', toBoolean),
        'eval/singleton-expected',
      );
    });

    it('raises eval/singleton-expected for more than one item where another type is expected', () => {
      expectEvaluationError(
        () => singleton([1, 2, 3], 'Integer', toInteger),
        'eval/singleton-expected',
      );
    });

    it('raises eval/singleton-expected for more than one item even when each would convert', () => {
      expectEvaluationError(
        () => singleton(['a', 'b'], 'String', toText),
        'eval/singleton-expected',
      );
    });

    it('raises eval/type-mismatch for a single item that does not convert', () => {
      // `'abc'.substring('x')`: one argument, of the wrong type. `first()` would not help.
      expectEvaluationError(() => singleton(['5'], 'Integer', toInteger), 'eval/type-mismatch');
      expectEvaluationError(() => singleton([true], 'String', toText), 'eval/type-mismatch');
      expectEvaluationError(
        () => singleton([new ModelNode({ value: {}, name: 'name' })], 'Decimal', toDecimalText),
        'eval/type-mismatch',
      );
      expectEvaluationError(() => singleton([1], 'Any', () => undefined), 'eval/type-mismatch');
    });

    it('follows the same rules when the expected type is only known at runtime', () => {
      const integer = ((): SystemTypeName => 'Integer')();
      const boolean = ((): SystemTypeName => 'Boolean')();
      expectEvaluationError(() => singleton(['5'], integer, toInteger), 'eval/type-mismatch');
      expectEvaluationError(() => singleton([1, 2], integer, toInteger), 'eval/singleton-expected');
      expect(singleton(['5'], boolean, toInteger)).toBe(true);
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

// docs/tasks/T0018-model-aware-evaluation.md#choice-types-and-primitive-extensions
describe('input nodes without a value', () => {
  const extensionOnly = new ModelNode({
    value: undefined,
    name: 'active',
    primitiveElement: {
      extension: [{ url: 'http://example.org/missing', valueString: 'unknown' }],
    },
  });
  const nodeOnly: ItemConversion<Item> = (item) => item;

  it('are empty where a Boolean is expected, not the true of a non-Boolean item', () => {
    expect(singleton([extensionOnly], 'Boolean', toBoolean)).toBeUndefined();
  });

  it('are empty where another type is expected, not a type mismatch', () => {
    expect(singleton([extensionOnly], 'Integer', toInteger)).toBeUndefined();
    expect(singleton([extensionOnly], 'String', toText)).toBeUndefined();
  });

  it('are passed on where any item is accepted, so type tests still see the node', () => {
    expect(singleton([extensionOnly], 'Any', nodeOnly)).toBe(extensionOnly);
  });

  it('still count as items for the cardinality rule', () => {
    expectEvaluationError(
      () => singleton([extensionOnly, extensionOnly], 'Boolean', toBoolean),
      'eval/singleton-expected',
    );
  });

  it('do not change a node that holds a value', () => {
    const active = new ModelNode({ value: true, name: 'active' });
    // This test conversion reads JavaScript Booleans only, so the node takes the step-2 fallback.
    expect(singleton([active], 'Boolean', toBoolean)).toBe(true);
    expect(singleton([active], 'Any', nodeOnly)).toBe(active);
  });
});
