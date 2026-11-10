import { describe, expect, it } from 'vitest';
import { Decimal, MAX_DECIMAL_DIGITS } from '../values/decimal/decimal.ts';
import { JsonNumber, type JsonValue, parseJson } from './lossless-json.ts';

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

/** The parsed value with every JsonNumber replaced by its text, for comparisons. */
function texts(value: JsonValue): unknown {
  if (value instanceof JsonNumber) {
    return `#${value.text}`;
  }
  if (Array.isArray(value)) {
    return value.map(texts);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, texts(member)]));
  }
  return value;
}

// https://www.rfc-editor.org/rfc/rfc8259
describe('parseJson', () => {
  it('parses every kind of value, keeping numbers as written', () => {
    const text =
      '{"resourceType":"Observation","value":{"value":1.50,"big":9.5e2,"n":-0,"i":185},' +
      '"flags":[true,false,null],"text":"a\\"b","empty":{},"none":[]}';
    expect(texts(parseJson(text))).toEqual({
      resourceType: 'Observation',
      value: { value: '#1.50', big: '#9.5e2', n: '#-0', i: '#185' },
      flags: [true, false, null],
      text: 'a"b',
      empty: {},
      none: [],
    });
  });

  it('gives the same values as JSON.parse apart from the numbers', () => {
    const text = JSON.stringify({
      a: [1, [2, [3, { b: 'c', d: [[]] }]], {}],
      e: 'x',
      'f g': null,
      h: true,
    });
    expect(JSON.parse(JSON.stringify(parseJson(text)))).toEqual(JSON.parse(text));
  });

  it.each([' \t\r\n{ "a" : [ 1 , 2 ] } \n', '{"a":[1,2]}'])(
    'allows the JSON whitespace in %j',
    (text) => {
      expect(texts(parseJson(text))).toEqual({ a: ['#1', '#2'] });
    },
  );

  it.each<[string, JsonValue]>([
    ['"plain"', 'plain'],
    ['true', true],
    ['false', false],
    ['null', null],
  ])('parses the top-level scalar %s', (text, expected) => {
    expect(parseJson(text)).toBe(expected);
  });

  it('parses a top-level number', () => {
    const value = parseJson('12.30');
    expect(value).toBeInstanceOf(JsonNumber);
    expect(String(value)).toBe('12.30');
  });

  it('decodes string escapes, including surrogate pairs and lone surrogates', () => {
    expect(parseJson('"\\" \\\\ \\/ \\b \\f \\n \\r \\t \\u00e9 \\uD83D\\uDE00 \\uD83D"')).toBe(
      '" \\ / \b \f \n \r \t é 😀 \uD83D',
    );
  });

  it('keeps keys in document order and lets a later duplicate win', () => {
    const value = parseJson('{"b":1,"a":2,"b":3}');
    expect(Object.keys(value as object)).toEqual(['b', 'a']);
    expect(texts(value)).toEqual({ b: '#3', a: '#2' });
  });

  it('makes __proto__ an own property without changing the prototype', () => {
    const value = parseJson('{"__proto__":{"polluted":true},"a":1}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expect(Object.hasOwn({}, 'polluted')).toBe(false);
    expect(Object.getOwnPropertyDescriptor(value, '__proto__')?.value).toEqual({ polluted: true });
    expect(Object.keys(value)).toEqual(['__proto__', 'a']);
  });

  // The depth is what shows that parsing does not recurse. The walk asserts once at the end:
  // an expect call per level took over 10 s on a loaded machine (#174).
  it('is not limited by the call stack', () => {
    const depth = 200_000;
    let current: JsonValue | undefined = parseJson(`${'['.repeat(depth)}1${']'.repeat(depth)}`);
    let levels = 0;
    while (Array.isArray(current)) {
      current = current[0];
      levels++;
    }
    expect(levels).toBe(depth);
    expect(current).toBeInstanceOf(JsonNumber);
  });

  it.each([
    ['', 'empty text'],
    ['   ', 'only whitespace'],
    ['{', 'an unterminated object'],
    ['{"a"', 'a key without a value'],
    ['{"a":}', 'a missing value'],
    ['{"a":1,}', 'a trailing comma in an object'],
    ['[1,]', 'a trailing comma in an array'],
    ['[1 2]', 'a missing comma'],
    ['{a:1}', 'an unquoted key'],
    ["'a'", 'single quotes'],
    ['"abc', 'an unterminated string'],
    ['"a\nb"', 'a control character in a string'],
    ['"\\x"', 'an unknown escape'],
    ['"\\u12G4"', 'an invalid unicode escape'],
    ['01', 'a leading zero'],
    ['1.', 'a fraction without digits'],
    ['.5', 'a number without an integer part'],
    ['+1', 'a plus sign'],
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
    ['tru', 'a truncated literal'],
    ['nulls', 'trailing characters'],
    ['{} {}', 'two values'],
    ['// comment\n1', 'a comment'],
    ['﻿1', 'a byte order mark'],
  ])('rejects %j (%s) with eval/invalid-json', (text) => {
    expect(codeOf(() => parseJson(text))).toBe('eval/invalid-json');
    expect(() => JSON.parse(text)).toThrow();
  });

  it('reports where the problem is', () => {
    expect(() => parseJson('{"a": 1, "b": }')).toThrow(/position 14/);
    expect(() => parseJson('[1, 2')).toThrow(/end of input at position 5/);
  });

  it('rejects input that is not a string', () => {
    expect(codeOf(() => parseJson(1 as never))).toBe('eval/invalid-json');
  });
});

describe('JsonNumber', () => {
  it('keeps the text and behaves like the nearest number in JavaScript', () => {
    const number = new JsonNumber('1.50');
    expect(number.text).toBe('1.50');
    expect(number.toNumber()).toBe(1.5);
    expect(number.valueOf()).toBe(1.5);
    expect(number.toString()).toBe('1.50');
    expect(JSON.stringify({ number })).toBe('{"number":1.5}');
    expect(Object.isFrozen(number)).toBe(true);
  });

  it.each(['1.', 'abc', '01', '+1', '', '1e'])(
    'rejects the text %j, which is not a JSON number',
    (text) => {
      expect(codeOf(() => new JsonNumber(text))).toBe('eval/invalid-argument');
    },
  );

  // https://hl7.org/fhirpath/N1/#integer: whole numbers written as such, in the 32-bit range.
  it.each<[string, number | undefined]>([
    ['0', 0],
    ['-0', 0],
    ['185', 185],
    ['-2147483648', -(2 ** 31)],
    ['2147483647', 2 ** 31 - 1],
    ['2147483648', undefined],
    ['1.0', undefined],
    ['1e2', undefined],
    ['1E2', undefined],
  ])('toInteger() of %s is %s', (text, expected) => {
    expect(new JsonNumber(text).toInteger()).toBe(expected);
  });

  it('gives -0 as a positive zero Integer', () => {
    expect(Object.is(new JsonNumber('-0').toInteger(), 0)).toBe(true);
  });

  // https://hl7.org/fhirpath/N1/#decimal: the precision of the text is kept.
  it.each<[string, string]>([
    ['1.50', '1.50'],
    ['185', '185'],
    ['-0.0', '0.0'],
    ['9.5e2', '950'],
    ['9.50e2', '950'],
    ['1.50e1', '15.0'],
    ['12.345e1', '123.45'],
    ['1E-2', '0.01'],
    ['1.5e-3', '0.0015'],
    ['-1.25e+1', '-12.5'],
    ['0e100', '0'],
    ['0.0e-5', '0.000000'],
  ])('toDecimal() of %s is %s', (text, expected) => {
    expect(new JsonNumber(text).toDecimal()?.toString()).toBe(expected);
  });

  it('keeps the scale of exponent forms exactly', () => {
    expect(new JsonNumber('1.50e1').toDecimal()).toEqual(Decimal.parse('15.0'));
  });

  it('gives no Decimal beyond the size bound', () => {
    expect(new JsonNumber(`1e${MAX_DECIMAL_DIGITS + 1}`).toDecimal()).toBeUndefined();
    expect(new JsonNumber(`1e-${MAX_DECIMAL_DIGITS + 1}`).toDecimal()).toBeUndefined();
    expect(new JsonNumber(`1${'0'.repeat(MAX_DECIMAL_DIGITS)}`).toDecimal()).toBeUndefined();
    expect(new JsonNumber(`1e${MAX_DECIMAL_DIGITS - 1}`).toDecimal()).toBeDefined();
  });
});
