import { describe, expect, it } from 'vitest';
import {
  appendAll,
  type Collection,
  concat,
  EMPTY,
  fromBoolean,
  fromOptional,
  type Item,
} from './collection.ts';

describe('EMPTY', () => {
  it('is an empty, frozen array', () => {
    expect(EMPTY).toEqual([]);
    expect(Object.isFrozen(EMPTY)).toBe(true);
  });
});

describe('fromOptional', () => {
  it('wraps an item', () => {
    expect(fromOptional('a')).toEqual(['a']);
  });

  it.each<[Item]>([[false], [0], ['']])('wraps the falsy item %j', (item) => {
    expect(fromOptional(item)).toEqual([item]);
  });

  it('gives EMPTY for undefined', () => {
    expect(fromOptional(undefined)).toBe(EMPTY);
  });
});

describe('fromBoolean', () => {
  it.each([
    [true, [true]],
    [false, [false]],
    [undefined, []],
  ])('gives the collection for %s', (value, expected) => {
    expect(fromBoolean(value)).toEqual(expected);
  });

  it('shares frozen collections', () => {
    expect(fromBoolean(true)).toBe(fromBoolean(true));
    expect(fromBoolean(false)).toBe(fromBoolean(false));
    expect(fromBoolean(undefined)).toBe(EMPTY);
    expect(Object.isFrozen(fromBoolean(true))).toBe(true);
    expect(Object.isFrozen(fromBoolean(false))).toBe(true);
  });
});

describe('concat', () => {
  // https://hl7.org/fhirpath/N1/#combineother-collection-collection
  it('keeps the order and the duplicates', () => {
    expect(concat([1, 2], [2, 3])).toEqual([1, 2, 2, 3]);
  });

  it('does not change its inputs', () => {
    const left: Collection = [1];
    const right: Collection = [2];
    concat(left, right);
    expect(left).toEqual([1]);
    expect(right).toEqual([2]);
  });

  it('returns the other input when one side is empty', () => {
    const items: Collection = ['a'];
    expect(concat(items, EMPTY)).toBe(items);
    expect(concat(EMPTY, items)).toBe(items);
    expect(concat(EMPTY, EMPTY)).toBe(EMPTY);
  });
});

describe('appendAll', () => {
  it('appends every item in order', () => {
    const target: Item[] = ['a'];
    appendAll(target, ['b', 'c']);
    expect(target).toEqual(['a', 'b', 'c']);
  });

  it('handles collections too large to spread into push()', () => {
    const source: Collection = new Array<number>(200_000).fill(1);
    const target: Item[] = [];
    appendAll(target, source);
    expect(target.length).toBe(200_000);
  });
});
