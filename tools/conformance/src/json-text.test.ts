import { describe, expect, it } from 'vitest';
import {
  type JsonValue,
  NumberLexeme,
  parseJsonKeepingNumbers,
  stringifyJson,
} from './json-text.ts';

describe('NumberLexeme', () => {
  // https://www.rfc-editor.org/rfc/rfc8259#section-6
  it.each(['0', '-0', '1.50', '9.5e2', '1.5E-3', '-12345678901234567890.000'])(
    'holds %s',
    (text) => {
      expect(new NumberLexeme(text).text).toBe(text);
    },
  );

  it.each(['+1', '01', '.5', '1.', '1e', 'NaN', 'Infinity', ' 1', ''])('refuses %j', (text) => {
    expect(() => new NumberLexeme(text)).toThrow(RangeError);
  });
});

describe('stringifyJson', () => {
  it('lays out values as JSON.stringify with two spaces does', () => {
    const value: JsonValue = new Map<string, JsonValue>([
      ['a', 'x"y'],
      ['b', [true, null, []]],
      ['c', new Map()],
      ['d', 'caf\u{E9}\n'],
    ]);
    const plain = { a: 'x"y', b: [true, null, []], c: {}, d: 'caf\u{E9}\n' };
    expect(stringifyJson(value)).toBe(`${JSON.stringify(plain, null, 2)}\n`);
  });

  it('writes numbers as their text', () => {
    const value: JsonValue = new Map<string, JsonValue>([
      ['v', [new NumberLexeme('1.50'), new NumberLexeme('9.5e2')]],
    ]);
    expect(stringifyJson(value)).toBe('{\n  "v": [\n    1.50,\n    9.5e2\n  ]\n}\n');
  });
});

describe('parseJsonKeepingNumbers', () => {
  it('reads each number as its source text', () => {
    expect(parseJsonKeepingNumbers('{"a": 1.50, "b": [9.5e2, -0], "c": "1.50"}')).toEqual({
      a: new NumberLexeme('1.50'),
      b: [new NumberLexeme('9.5e2'), new NumberLexeme('-0')],
      c: '1.50',
    });
  });

  it('round-trips what stringifyJson writes', () => {
    const text = stringifyJson(new Map<string, JsonValue>([['n', new NumberLexeme('0.10')]]));
    expect(parseJsonKeepingNumbers(text)).toEqual({ n: new NumberLexeme('0.10') });
  });
});
