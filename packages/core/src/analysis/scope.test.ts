import { describe, expect, it } from 'vitest';
import { parse } from '../parser/parser.ts';
import { pathKey } from './scope.ts';

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
