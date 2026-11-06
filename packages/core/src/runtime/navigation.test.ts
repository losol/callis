import { describe, expect, it } from 'vitest';
import { ModelNode } from '../model/model-node.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import type { Collection } from './collection.ts';
import {
  hasResourceType,
  navigateMember,
  navigateRoot,
  resourceTypeOf,
  toInputCollection,
} from './navigation.ts';

/** An array of `length` holes whose prototype, below `Array.prototype`, has `inherited` indices. */
function inheritingArray(length: number, inherited: Record<number, unknown>): unknown[] {
  const array: unknown[] = new Array(length);
  Object.setPrototypeOf(array, Object.assign(Object.create(Array.prototype), inherited));
  return array;
}

function values(collection: Collection): unknown[] {
  return collection.map((item) => (item instanceof ModelNode ? item.value : item));
}

// Model-less navigation of plain JSON: https://hl7.org/fhirpath/N1/#navigation-model
describe('toInputCollection', () => {
  it.each([undefined, null, []])('gives empty for %j', (value) => {
    expect(toInputCollection(value, 'x')).toEqual([]);
  });

  it('wraps JSON objects and primitives in input nodes', () => {
    const [object, text, number, flag] = toInputCollection([{ a: 1 }, 'a', 1, true], 'v');
    for (const node of [object, text, number, flag]) {
      expect(node).toBeInstanceOf(ModelNode);
    }
    expect(values(toInputCollection([{ a: 1 }, 'a', 1, true], 'v'))).toEqual([
      { a: 1 },
      'a',
      1,
      true,
    ]);
  });

  it('names a node by its resourceType, or by the given name', () => {
    const [patient, other] = toInputCollection([{ resourceType: 'Patient' }, {}], 'input');
    expect((patient as ModelNode).name).toBe('Patient');
    expect((other as ModelNode).name).toBe('input');
  });

  it('flattens nested arrays and skips null elements', () => {
    expect(values(toInputCollection([1, null, [2, [3]]], 'v'))).toEqual([1, 2, 3]);
  });

  it('does not read array elements inherited from a prototype', () => {
    const array = inheritingArray(2, { 0: { inherited: true } });
    array[1] = 'own';
    expect(values(toInputCollection(array, 'v'))).toEqual(['own']);
  });

  it('keeps nodes and value classes as they are', () => {
    const node = new ModelNode({ value: 'x', name: 'x' });
    expect(toInputCollection([node, Decimal.ONE, 1n], 'v')).toEqual([node, Decimal.ONE, 1n]);
  });

  it.each([() => 1, Symbol('s')])('raises eval/invalid-argument for %s', (value) => {
    expect(() => toInputCollection(value, 'v')).toThrow(
      expect.objectContaining({ code: 'eval/invalid-argument' }),
    );
  });
});

describe('navigateMember', () => {
  const root = toInputCollection(
    { a: [{ b: 1 }, null, { b: [2, null, 3] }], c: 'x', d: null, e: [] },
    'root',
  );

  it('follows own properties and flattens arrays in order', () => {
    expect(values(navigateMember(navigateMember(root, 'a'), 'b'))).toEqual([1, 2, 3]);
  });

  it('records the name, parent and array index of each node', () => {
    const [first, second] = navigateMember(root, 'a');
    expect(first).toMatchObject({ name: 'a', index: 0, parent: root[0] });
    // The null element is skipped, but the index still counts it.
    expect(second).toMatchObject({ name: 'a', index: 2 });
    const [single] = navigateMember(root, 'c');
    expect(single).toMatchObject({ name: 'c', index: undefined });
  });

  it('gives empty for a missing, null or empty property', () => {
    for (const name of ['missing', 'd', 'e']) {
      expect(navigateMember(root, name)).toEqual([]);
    }
  });

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'prototype'])(
    'never reaches the prototype member %s',
    (name) => {
      expect(navigateMember(root, name)).toEqual([]);
    },
  );

  it('does not read array elements inherited from a prototype, and keeps the own indices', () => {
    const array = inheritingArray(3, { 0: 'inherited', 2: 'inherited' });
    array[1] = 'own';
    const [node, ...rest] = navigateMember(toInputCollection({ a: array }, 'root'), 'a');
    expect(rest).toEqual([]);
    expect(node).toMatchObject({ value: 'own', index: 1 });
  });

  it('skips holes in arrays', () => {
    // biome-ignore lint/suspicious/noSparseArray: the test needs a hole.
    const values = navigateMember(toInputCollection({ a: [1, , 3] }, 'root'), 'a');
    expect(values.map((item) => (item as ModelNode).index)).toEqual([0, 2]);
  });

  it('does not read inherited properties', () => {
    const input = toInputCollection(Object.create({ inherited: 1 }), 'root');
    expect(navigateMember(input, 'inherited')).toEqual([]);
  });

  it('gives no children for primitives and computed values', () => {
    expect(navigateMember(navigateMember(root, 'c'), 'length')).toEqual([]);
    expect(navigateMember(['text', 1, true, Decimal.ONE], 'length')).toEqual([]);
  });
});

describe('navigateRoot', () => {
  const patient = toInputCollection({ resourceType: 'Patient', id: 'p', Patient: 'child' }, 'r');

  // https://hl7.org/fhirpath/N1/#models; T0018 navigation rules for the model-less case.
  it('gives the item itself when the name is its resourceType', () => {
    expect(navigateRoot(patient, 'Patient')).toEqual(patient);
  });

  it('is an ordinary path step otherwise', () => {
    expect(values(navigateRoot(patient, 'id'))).toEqual(['p']);
    expect(navigateRoot(patient, 'Observation')).toEqual([]);
  });

  it('decides for each item', () => {
    const mixed = toInputCollection([{ resourceType: 'Patient' }, { Patient: 1 }], 'r');
    expect(values(navigateRoot(mixed, 'Patient'))).toEqual([{ resourceType: 'Patient' }, 1]);
  });
});

describe('resourceTypeOf and hasResourceType', () => {
  it('reads an own string resourceType', () => {
    expect(resourceTypeOf({ resourceType: 'Patient' })).toBe('Patient');
  });

  it.each<[string, unknown]>([
    ['an inherited one', Object.create({ resourceType: 'Patient' })],
    ['a number', { resourceType: 1 }],
    ['null', { resourceType: null }],
    ['an array', [{ resourceType: 'Patient' }]],
    ['a string value', 'Patient'],
    ['null input', null],
  ])('ignores %s', (_label, value) => {
    expect(resourceTypeOf(value)).toBeUndefined();
  });

  it('matches only input nodes, case-sensitively', () => {
    const [node] = toInputCollection({ resourceType: 'Patient' }, 'r');
    expect(node !== undefined && hasResourceType(node, 'Patient')).toBe(true);
    expect(node !== undefined && hasResourceType(node, 'patient')).toBe(false);
    expect(hasResourceType('Patient', 'Patient')).toBe(false);
  });
});
