import { describe, expect, it } from 'vitest';
import { parse } from '../parser/parser.ts';
import { SYSTEM_TYPES } from '../types/system-types.ts';
import {
  bothGuards,
  type Constraint,
  coalesce,
  eitherGuard,
  MAX_CONSTRAINTS_PER_KEY,
  pathKey,
} from './scope.ts';

const integer: Constraint = { key: '$this', include: [SYSTEM_TYPES.Integer] };
const string: Constraint = { key: '$this', include: [SYSTEM_TYPES.String] };
const other: Constraint = { key: '%"v"', include: [SYSTEM_TYPES.Decimal] };

describe('coalesce', () => {
  it('keeps equal constraints once, and at most the limit per path', () => {
    expect(coalesce([integer, integer, { ...integer }])).toEqual([integer]);
    expect(coalesce([integer, string, other])).toEqual([integer, string, other]);
    const many = Array.from({ length: 20 }, (_, index) => ({
      key: '$this',
      include: [index % 2 === 0 ? SYSTEM_TYPES.Integer : SYSTEM_TYPES.String],
      exclude: [index < 10 ? SYSTEM_TYPES.Date : SYSTEM_TYPES.Time],
    }));
    expect(coalesce(many).length).toBeLessThanOrEqual(MAX_CONSTRAINTS_PER_KEY);
  });
});

describe('bothGuards and eitherGuard', () => {
  it('do not multiply the constraints of a chain', () => {
    let guard: readonly Constraint[] = bothGuards([integer], [integer]);
    for (let step = 0; step < 30; step++) {
      guard = eitherGuard(guard, bothGuards([integer], [integer]));
    }
    expect(guard).toEqual([{ key: '$this', include: [SYSTEM_TYPES.Integer] }]);
  });

  it('widens to the union of the includes past the limit, per path', () => {
    const left = Array.from({ length: 4 }, (_, index) => ({
      key: '$this',
      include: [index < 2 ? SYSTEM_TYPES.Integer : SYSTEM_TYPES.String],
      exclude: [index % 2 === 0 ? SYSTEM_TYPES.Date : SYSTEM_TYPES.Time],
    }));
    const right = [...left, other];
    const result = eitherGuard(left, right);
    expect(result).toHaveLength(1);
    expect(result[0]?.include?.map((type) => type.name)).toEqual(
      expect.arrayContaining(['Integer', 'String']),
    );
    expect(eitherGuard([integer, other], [other, string])).toEqual([
      { key: '$this', include: [SYSTEM_TYPES.Integer, SYSTEM_TYPES.String] },
      { key: '%"v"', include: [SYSTEM_TYPES.Decimal] },
    ]);
  });
});

describe('pathKey', () => {
  it.each([
    ['$this', '$this'],
    ['a', '$this."a"'],
    ['a.b', '$this."a"."b"'],
    ['`a.b`', '$this."a.b"'],
    ['$this.a.`b.c`', '$this."a"."b.c"'],
    ['%v', '%"v"'],
    ['%v.x', '%"v"."x"'],
    ['%`v.x`', '%"v.x"'],
    ['%`vs-x`.a', '%"vs-x"."a"'],
    ['`a"b`', '$this."a\\"b"'],
  ])('names %s as %s', (expression, key) => {
    expect(pathKey(parse(expression))).toBe(key);
  });

  it.each(['a.first()', 'a[0]', 'name.$this', '$index', '1', 'a | b', '(a is Integer)'])(
    'gives no key for %s',
    (expression) => {
      expect(pathKey(parse(expression))).toBeUndefined();
    },
  );
});
