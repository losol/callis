import { describe, expect, it } from 'vitest';
import type { SyntaxErrorCode } from '../errors/error-codes.ts';
import { FhirPathSyntaxError } from '../errors/fhirpath-error.ts';
import { type LexerOptions, tokenize } from './lexer.ts';
import type { SymbolKind, TokenKind } from './token.ts';

/** The tokens of an expression as `[kind, value]` pairs, without the final EOF token. */
function lex(expression: string, options?: LexerOptions): [TokenKind, string][] {
  const tokens = tokenize(expression, options);
  expect(tokens.at(-1)).toEqual({
    kind: 'EOF',
    start: expression.length,
    end: expression.length,
    value: '',
  });
  return tokens.slice(0, -1).map((token) => [token.kind, token.value]);
}

/** The error that tokenizing an expression throws. */
function lexError(expression: string): FhirPathSyntaxError {
  try {
    tokenize(expression);
  } catch (error) {
    expect(error).toBeInstanceOf(FhirPathSyntaxError);
    if (error instanceof FhirPathSyntaxError) {
      return error;
    }
  }
  return expect.unreachable(`expected a syntax error for ${JSON.stringify(expression)}`);
}

/** Asserts the error code and the `[start, end)` span of the error for an expression. */
function expectError(expression: string, code: SyntaxErrorCode, start: number, end: number): void {
  const error = lexError(expression);
  expect({ code: error.code, start: error.span?.start, end: error.span?.end }).toEqual({
    code,
    start,
    end,
  });
}

describe('tokenize', () => {
  describe('token kinds and spans', () => {
    it.each([
      ['name', 'Identifier', 0, 4, 'name'],
      ['`div`', 'DelimitedIdentifier', 0, 5, 'div'],
      [String.raw`'a\nb'`, 'String', 0, 6, 'a\nb'],
      ['1.50', 'Number', 0, 4, '1.50'],
      ['@2015-02-04', 'Date', 0, 11, '@2015-02-04'],
      ['@2015-02-04T14:34', 'DateTime', 0, 17, '@2015-02-04T14:34'],
      ['@T14:34', 'Time', 0, 7, '@T14:34'],
      ['%ucum', 'EnvironmentVariable', 0, 5, 'ucum'],
      ['$this', '$this', 0, 5, '$this'],
      ['$index', '$index', 0, 6, '$index'],
      ['$total', '$total', 0, 6, '$total'],
      ['  name  ', 'Identifier', 2, 6, 'name'],
    ] as const)('%s is a %s token', (expression, kind, start, end, value) => {
      expect(tokenize(expression)).toEqual([
        { kind, start, end, value },
        { kind: 'EOF', start: expression.length, end: expression.length, value: '' },
      ]);
    });

    it('returns only the EOF token for an empty expression', () => {
      expect(tokenize('')).toEqual([{ kind: 'EOF', start: 0, end: 0, value: '' }]);
    });

    it('gives every token of a whole expression its exact span', () => {
      const expression = "Patient.name.where(use = 'official').given[0]";
      const tokens = tokenize(expression);
      expect(tokens.map(({ kind, start, end }) => [kind, start, end])).toEqual([
        ['Identifier', 0, 7],
        ['.', 7, 8],
        ['Identifier', 8, 12],
        ['.', 12, 13],
        ['Identifier', 13, 18],
        ['(', 18, 19],
        ['Identifier', 19, 22],
        ['=', 23, 24],
        ['String', 25, 35],
        [')', 35, 36],
        ['.', 36, 37],
        ['Identifier', 37, 42],
        ['[', 42, 43],
        ['Number', 43, 44],
        [']', 44, 45],
        ['EOF', 45, 45],
      ]);
    });
  });

  // https://hl7.org/fhirpath/N1/#symbols
  describe('symbols (N1 §8.4)', () => {
    const symbols: SymbolKind[] = [
      '(',
      ')',
      '[',
      ']',
      '{',
      '}',
      '.',
      ',',
      '=',
      '!=',
      '~',
      '!~',
      '<',
      '<=',
      '>',
      '>=',
      '+',
      '-',
      '*',
      '/',
      '|',
      '&',
    ];

    it.each(symbols)('%s', (symbol) => {
      expect(tokenize(`a${symbol}b`)).toEqual([
        { kind: 'Identifier', start: 0, end: 1, value: 'a' },
        { kind: symbol, start: 1, end: 1 + symbol.length, value: symbol },
        { kind: 'Identifier', start: 1 + symbol.length, end: 2 + symbol.length, value: 'b' },
        { kind: 'EOF', start: 2 + symbol.length, end: 2 + symbol.length, value: '' },
      ]);
    });

    it.each([
      ['< =', ['<', '=']],
      ['> =', ['>', '=']],
      ['<<=', ['<', '<=']],
      ['>==', ['>=', '=']],
      ['!==', ['!=', '=']],
      ['{}', ['{', '}']],
      ['{ }', ['{', '}']],
    ])('splits %j into the longest symbols', (expression, kinds) => {
      expect(lex(expression).map(([kind]) => kind)).toEqual(kinds);
    });

    it('rejects ! without = or ~', () => {
      expectError('a ! b', 'syntax/unexpected-character', 2, 3);
      expectError('!', 'syntax/unexpected-character', 0, 1);
    });
  });

  // https://hl7.org/fhirpath/N1/#whitespace
  describe('whitespace (N1 §8.1)', () => {
    it('separates tokens with tab, space, line feed and carriage return', () => {
      expect(lex('a\tb c\nd\re\r\nf')).toEqual([
        ['Identifier', 'a'],
        ['Identifier', 'b'],
        ['Identifier', 'c'],
        ['Identifier', 'd'],
        ['Identifier', 'e'],
        ['Identifier', 'f'],
      ]);
    });

    it.each([
      ['form feed', '\f', 0x0c],
      ['vertical tab', '\v', 0x0b],
      ['no-break space', '\u00a0', 0xa0],
      ['byte order mark', '\ufeff', 0xfeff],
      ['line separator', '\u2028', 0x2028],
    ])('rejects other whitespace: %s', (_name, whitespace) => {
      expectError(`a${whitespace}b`, 'syntax/unexpected-character', 1, 2);
    });
  });

  // https://hl7.org/fhirpath/N1/#comments
  describe('comments (N1 §8.2)', () => {
    it.each([
      // The examples in N1 §8.2.
      ['2 + 2 // This is a single-line comment', ['2', '+', '2']],
      ['/*\nThis is a multi-line comment\nAny text enclosed within is ignored\n*/', []],
      // The `comments` group of the HL7 suite.
      ['2 + 2 // This is a single-line comment + 4', ['2', '+', '2']], // testComment1
      [
        '// This is a multi line comment using // that\n  // should not fail during parsing\n  2+2',
        ['2', '+', '2'],
      ], // testComment2
      [
        '2 + 2 \n      /*\nThis is a multi-line comment\nAny text enclosed within is ignored\n+2\n*/',
        ['2', '+', '2'],
      ], // testComment3
      [
        '2 + 2 \n      /*\nThis is a multi-line comment\nAny text enclosed within is ignored\n*/\n+2',
        ['2', '+', '2', '+', '2'],
      ], // testComment4
      [
        '/*\nThis is a multi-line comment\nAny text enclosed within is ignored\n*/\n2+2',
        ['2', '+', '2'],
      ], // testComment5
      ['2 // comment\n/ 2', ['2', '/', '2']], // testComment6
      ['2 + 2 /', ['2', '+', '2', '/']], // testComment7: the parser rejects the trailing '/'
      ['2 + /* inline $@%^+ * */ 2 = 4', ['2', '+', '2', '=', '4']], // testComment9
      // Edges.
      ['a/**/b', ['a', 'b']],
      ['a/***/b', ['a', 'b']],
      ['a /* x */ /* y */ b', ['a', 'b']],
      ['a /* /* */ */', ['a', '*', '/']], // comments do not nest
      ['a // x\rb', ['a', 'b']], // a lone carriage return ends a line comment
      ['a //', ['a']],
      ["a // 'unterminated", ['a']],
      ['1/2', ['1', '/', '2']],
    ])('%j', (expression, values) => {
      expect(lex(expression).map(([, value]) => value)).toEqual(values);
    });

    it('rejects an unterminated block comment (testComment8)', () => {
      expectError('2 + 2 /* not finished', 'syntax/unterminated-comment', 6, 21);
    });

    it.each(['/*', '/*/', '/* *', 'a /* b * /'])('rejects the unterminated comment %j', (expr) => {
      const error = lexError(expr);
      expect(error.code).toBe('syntax/unterminated-comment');
      expect(error.span?.end).toBe(expr.length);
    });
  });

  // https://hl7.org/fhirpath/N1/#keywords
  describe('keywords (N1 §8.5)', () => {
    const keywords = [
      'and',
      'as',
      'contains',
      'day',
      'days',
      'div',
      'false',
      'hour',
      'hours',
      'implies',
      'in',
      'is',
      'millisecond',
      'milliseconds',
      'minute',
      'minutes',
      'mod',
      'month',
      'months',
      'or',
      'second',
      'seconds',
      'true',
      'week',
      'weeks',
      'xor',
      'year',
      'years',
    ];

    it.each(keywords)('%s is an identifier; the parser decides what it means', (keyword) => {
      expect(lex(keyword)).toEqual([['Identifier', keyword]]);
    });

    it('lexes the escaped keyword in the N1 §8.5 example as a delimited identifier', () => {
      expect(lex('Patient.text.`div`.empty()')).toEqual([
        ['Identifier', 'Patient'],
        ['.', '.'],
        ['Identifier', 'text'],
        ['.', '.'],
        ['DelimitedIdentifier', 'div'],
        ['.', '.'],
        ['Identifier', 'empty'],
        ['(', '('],
        [')', ')'],
      ]);
    });

    // https://hl7.org/fhirpath/N1/#case-sensitivity
    it.each(['True', 'AND', 'Div'])('keeps the case of %s (N1 §8.7)', (word) => {
      expect(lex(word)).toEqual([['Identifier', word]]);
    });
  });

  // https://hl7.org/fhirpath/N1/#identifiers
  describe('identifiers (N1 §8.6)', () => {
    it.each(['Patient', '_id', 'valueDateTime', '_1234', 'a', 'Z9_'])('%s is simple', (name) => {
      expect(lex(name)).toEqual([['Identifier', name]]);
    });

    it.each([
      ['`QI-Core Patient`', 'QI-Core Patient'],
      ['`US-Core Diagnostic Request`', 'US-Core Diagnostic Request'],
      ['`us-zip`', 'us-zip'],
      ['`Patient`', 'Patient'], // testSimpleBackTick1
      ['`given`', 'given'], // testEscapedIdentifier
      ['`\\u006eame`', 'name'], // testEscapedIdentifierUnicode
      ['`a\\`b`', 'a`b'],
      ["`it's`", "it's"],
      ['`a\nb`', 'a\nb'],
      ['``', ''],
    ])('%s is delimited', (expression, name) => {
      expect(lex(expression)).toEqual([['DelimitedIdentifier', name]]);
    });

    it('starts a new token at a digit', () => {
      expect(lex('1abc')).toEqual([
        ['Number', '1'],
        ['Identifier', 'abc'],
      ]);
    });

    it.each([
      ['ñame', 0],
      ['naïve', 2],
      ['Ω', 0],
    ])('rejects the non-ASCII letter in %s', (expression, offset) => {
      expectError(expression, 'syntax/unexpected-character', offset, offset + 1);
    });

    it('rejects an unterminated delimited identifier', () => {
      expectError('name.`given', 'syntax/unterminated-string', 5, 11);
    });
  });

  // https://hl7.org/fhirpath/N1/#string
  describe('strings (N1 §4.1.2)', () => {
    it.each([
      ["'test string'", 'test string'],
      ["'urn:oid:3.4.5.6.7.8'", 'urn:oid:3.4.5.6.7.8'],
      ["''", ''],
      ["'a\"b`c'", 'a"b`c'],
      ["'a\nb\r\nc'", 'a\nb\r\nc'], // unescaped line breaks are allowed
      ["'/* not a comment */'", '/* not a comment */'],
      ["'// not a comment'", '// not a comment'],
      ["'😀'", '😀'],
    ])('%s', (expression, value) => {
      expect(lex(expression)).toEqual([['String', value]]);
    });

    // Every escape in the N1 §4.1.2 table, plus `\/` from the grammar.
    const escapes = [
      [String.raw`\'`, "'"],
      [String.raw`\"`, '"'],
      [String.raw`\``, '`'],
      [String.raw`\r`, '\r'],
      [String.raw`\n`, '\n'],
      [String.raw`\t`, '\t'],
      [String.raw`\f`, '\f'],
      [String.raw`\\`, '\\'],
      [String.raw`\/`, '/'],
      [String.raw`\u0041`, 'A'],
      [String.raw`\u00e9`, 'é'],
      [String.raw`\u00E9`, 'é'],
      [String.raw`\uFFFF`, '\uffff'],
      [String.raw`\uD83D\uDE00`, '😀'], // a surrogate pair
    ];

    it.each(escapes)('decodes %s in a string', (sequence, decoded) => {
      expect(lex(`'x${sequence}y'`)).toEqual([['String', `x${decoded}y`]]);
    });

    it.each(escapes)('decodes %s in a delimited identifier', (sequence, decoded) => {
      expect(lex(`\`x${sequence}y\``)).toEqual([['DelimitedIdentifier', `x${decoded}y`]]);
    });

    it('decodes every escape at once (testLiteralStringEscapes)', () => {
      expect(lex(String.raw`'\\\/\f\r\n\t\"\`\'\u002a'.convertsToString()`)).toEqual([
        ['String', '\\/\f\r\n\t"`\'*'],
        ['.', '.'],
        ['Identifier', 'convertsToString'],
        ['(', '('],
        [')', ')'],
      ]);
    });

    it('decodes a unicode escape (testLiteralUnicode)', () => {
      expect(lex(String.raw`'P\u0065ter'`)).toEqual([['String', 'Peter']]);
    });

    it('pairs an escaped surrogate with an unescaped one', () => {
      expect(lex("'\\uD83D\ude00'")).toEqual([['String', '😀']]);
      expect(lex("'\ud83d\\uDE00'")).toEqual([['String', '😀']]);
    });

    // N1 says the backslash of an unknown sequence is ignored, but the suite rejects `'\u+041'`
    // (testLiteralUnicodeInvalid), so Callis rejects them all. See docs/spec-notes.md.
    it.each([
      [String.raw`'\u+041'`, 1, 3], // testLiteralUnicodeInvalid
      [String.raw`'\p'`, 1, 3], // N1 §4.1.2: "'\p' // 'p'"
      [String.raw`'\3'`, 1, 3], // N1 §4.1.2: "'\3' // '3'"
      [String.raw`'\u005'`, 1, 6], // N1 §4.1.2: "'\u005' // 'u005'"
      [String.raw`'\u00'`, 1, 5],
      [String.raw`'\x41'`, 1, 3],
      [String.raw`'\U0041'`, 1, 3],
      [String.raw`'\b'`, 1, 3],
      [String.raw`'\v'`, 1, 3],
      [String.raw`'\0'`, 1, 3],
      [`'\\\n'`, 1, 3], // backslash and line feed
      [String.raw`'\😀'`, 1, 4], // the escaped character is two code units
      ['`\\p`', 1, 3],
      [String.raw`'abc\ q'`, 4, 6],
    ])('rejects the invalid escape in %s', (expression, start, end) => {
      expectError(expression, 'syntax/invalid-escape', start, end);
    });

    // https://hl7.org/fhirpath/STU3/#string: an escaped surrogate must be part of a pair.
    it.each([
      [String.raw`'\uD83D'`, 1, 7],
      [String.raw`'\uDE00'`, 1, 7],
      [String.raw`'\uD83Dx'`, 1, 7],
      [String.raw`'\uDE00\uD83D'`, 1, 7],
      [String.raw`'\uD83D\uD83D\uDE00'`, 1, 7],
      [String.raw`'\uD83D\u0041'`, 1, 7],
      ['`\\uDE00`', 1, 7],
    ])('rejects the unpaired surrogate escape in %s', (expression, start, end) => {
      expectError(expression, 'syntax/invalid-escape', start, end);
    });

    it.each([
      ["'abc", 0, 4],
      [String.raw`'abc\'`, 0, 6], // the quote is escaped
      ["'abc\\", 0, 5], // a backslash at the end escapes nothing
      // N1 §4.1.2 says "'\' // ''", but `\'` is an escaped quote (testLiteralStringEscapes), so
      // this string never ends. See docs/spec-notes.md.
      [String.raw`'\'`, 0, 3],
      ["'", 0, 1],
      ["name = 'official", 7, 16],
    ])('rejects the unterminated string %s', (expression, start, end) => {
      expectError(expression, 'syntax/unterminated-string', start, end);
    });
  });

  // https://hl7.org/fhirpath/N1/#integer, https://hl7.org/fhirpath/N1/#decimal
  describe('numbers (N1 §4.1.3, §4.1.4)', () => {
    it.each([
      '0',
      '45',
      '0.0',
      '3.14159265',
      '007', // leading zeros are allowed
      '00.50',
      '2147483647', // testLiteralIntegerMax
      '1234567890987654321.0', // testLiteralDecimalMax
      '0.00000001', // testLiteralDecimalStep
    ])('%s', (number) => {
      expect(lex(number)).toEqual([['Number', number]]);
    });

    it.each([
      ['1.toString()', ['Number', '.', 'Identifier', '(', ')']],
      ['1.5.toString()', ['Number', '.', 'Identifier', '(', ')']],
      ['1.', ['Number', '.']],
      ['1.5.3', ['Number', '.', 'Number']],
      ['1..2', ['Number', '.', '.', 'Number']],
      ['.5', ['.', 'Number']],
      ['-5', ['-', 'Number']], // the minus is an operator (N1 §4.1.3)
      ['-1.convertsToInteger()', ['-', 'Number', '.', 'Identifier', '(', ')']], // testLiteralIntegerNegative1Invalid
      ['1e5', ['Number', 'Identifier']], // no exponents (N1 §4.1.4)
      ['1L', ['Number', 'Identifier']], // Long literals come in phase 2 (T0028)
      ["4.5 'mg'", ['Number', 'String']], // a quantity is built by the parser (N1 §4.1.8)
      ["100 '[degF]'", ['Number', 'String']],
      ['4 days.convertsToQuantity()', ['Number', 'Identifier', '.', 'Identifier', '(', ')']], // testLiteralQuantityDay
    ])('%s', (expression, kinds) => {
      expect(lex(expression).map(([kind]) => kind)).toEqual(kinds);
    });

    it('keeps the number text in the value, so precision is not lost', () => {
      expect(lex('1.0 + 1.00')).toEqual([
        ['Number', '1.0'],
        ['+', '+'],
        ['Number', '1.00'],
      ]);
    });
  });

  // https://hl7.org/fhirpath/N1/#date, #time and #datetime
  describe('date and time literals (N1 §4.1.5–§4.1.7)', () => {
    it.each([
      // N1 §4.1.5
      ['@2014-01-25', 'Date'],
      ['@2014-01', 'Date'],
      ['@2014', 'Date'],
      // N1 §4.1.7
      ['@2014-01-25T14:30:14.559', 'DateTime'],
      ['@2014-01-25T14:30:14.559Z', 'DateTime'],
      ['@2014-01-25T14:30', 'DateTime'],
      ['@2014-03-25T', 'DateTime'],
      ['@2014-01T', 'DateTime'],
      ['@2014T', 'DateTime'],
      ['@2014-01-25T14', 'DateTime'],
      ['@2014-01-25T14:30:14', 'DateTime'],
      ['@2014-01-25T14:30:14+10:00', 'DateTime'],
      ['@2014-01-25T14:30:14-05:00', 'DateTime'],
      ['@2014-01-25T14:30Z', 'DateTime'],
      ['@2014-01-25T14+01:00', 'DateTime'],
      ['@2014T14:30', 'DateTime'], // the grammar allows a time after a year only
      ['@2017-11-05T01:30:00.0-04:00', 'DateTime'], // testLiteralDateTimeTZGreater
      ['@2014-01-25T14:30:14.123456789', 'DateTime'], // fractions of any length
      // N1 §4.1.6
      ['@T12:00', 'Time'],
      ['@T14:30:14.559', 'Time'],
      ['@T14', 'Time'],
      // A time zone on a Time literal is read here and rejected at evaluation (testLiteralTimeUTC,
      // testLiteralTimeTimezoneOffset); see T0008.
      ['@T14:34:28Z', 'Time'],
      ['@T14:34:28+10:00', 'Time'],
      ['@T14:34:28-10:00', 'Time'],
      // Values are checked by the compiler, not here.
      ['@2015-02-30', 'Date'],
      ['@0000-00-00', 'Date'],
      ['@2015-13-45T25:61:61.000+99:99', 'DateTime'],
      ['@T99:99', 'Time'],
    ])('%s is a %s', (literal, kind) => {
      expect(lex(literal)).toEqual([[kind, literal]]);
    });

    // The literal tests of the HL7 suite: a '.' without a digit after it ends the literal.
    it.each([
      ['@2015.is(Date)', 'Date', '@2015'], // testLiteralDateYear
      ['@2015-02.is(Date)', 'Date', '@2015-02'], // testLiteralDateMonth
      ['@2015-02-04.is(Date)', 'Date', '@2015-02-04'], // testLiteralDateDay
      ['@2015T.is(DateTime)', 'DateTime', '@2015T'], // testLiteralDateTimeYear
      ['@2015-02T.is(DateTime)', 'DateTime', '@2015-02T'], // testLiteralDateTimeMonth
      ['@2015-02-04T.is(DateTime)', 'DateTime', '@2015-02-04T'], // testLiteralDateTimeDay
      ['@2015-02-04T14.is(DateTime)', 'DateTime', '@2015-02-04T14'], // testLiteralDateTimeHour
      ['@2015-02-04T14:34.is(DateTime)', 'DateTime', '@2015-02-04T14:34'], // testLiteralDateTimeMinute
      ['@2015-02-04T14:34:28.is(DateTime)', 'DateTime', '@2015-02-04T14:34:28'], // testLiteralDateTimeSecond
      ['@2015-02-04T14:34:28.123.is(DateTime)', 'DateTime', '@2015-02-04T14:34:28.123'], // testLiteralDateTimeMillisecond
      ['@2015-02-04T14:34:28Z.is(DateTime)', 'DateTime', '@2015-02-04T14:34:28Z'], // testLiteralDateTimeUTC
      ['@2015-02-04T14:34:28+10:00.is(DateTime)', 'DateTime', '@2015-02-04T14:34:28+10:00'], // testLiteralDateTimeTimezoneOffset
      ['@T14.is(Time)', 'Time', '@T14'], // testLiteralTimeHour
      ['@T14:34.is(Time)', 'Time', '@T14:34'], // testLiteralTimeMinute
      ['@T14:34:28.is(Time)', 'Time', '@T14:34:28'], // testLiteralTimeSecond
      ['@T14:34:28.123.is(Time)', 'Time', '@T14:34:28.123'], // testLiteralTimeMillisecond
      ['@T14:34:28Z.is(Time)', 'Time', '@T14:34:28Z'], // testLiteralTimeUTC
      ['@T14:34:28+10:00.is(Time)', 'Time', '@T14:34:28+10:00'], // testLiteralTimeTimezoneOffset
    ])('%s', (expression, kind, literal) => {
      expect(lex(expression)).toEqual([
        [kind, literal],
        ['.', '.'],
        ['Identifier', 'is'],
        ['(', '('],
        ['Identifier', kind],
        [')', ')'],
      ]);
    });

    // Like the grammar's tokens, a literal is the longest prefix with a valid shape.
    it.each([
      ['@2015-1', ['@2015', '-', '1']],
      ["@2015-1 'year'", ['@2015', '-', '1', 'year']],
      ['@2015-01-1', ['@2015-01', '-', '1']],
      ['@2015-01-01-1', ['@2015-01-01', '-', '1']],
      ["@T14:30+1 'hour'", ['@T14:30', '+', '1', 'hour']],
      ['@T14:30:00+05', ['@T14:30:00', '+', '05']],
      ['@T14:30:00-1', ['@T14:30:00', '-', '1']],
      ['@2015-02-04Tx', ['@2015-02-04T', 'x']],
      ['@2015-02-04T14:34:28ZZ', ['@2015-02-04T14:34:28Z', 'Z']],
      ['@2015-02-04T14:34:28.', ['@2015-02-04T14:34:28', '.']],
      ['@2015x', ['@2015', 'x']],
      ['@2015-x', ['@2015', '-', 'x']],
      ['@T14x', ['@T14', 'x']],
      ['@2015 - @2014', ['@2015', '-', '@2014']],
      ['(@2015T)', ['(', '@2015T', ')']],
      ['@T10:00<@T11:00', ['@T10:00', '<', '@T11:00']],
    ])('%s', (expression, values) => {
      expect(lex(expression).map(([, value]) => value)).toEqual(values);
    });

    it.each([
      ['@', 0, 1],
      ['@x', 0, 1],
      ['@ 2015', 0, 1],
      ['@201', 0, 4],
      ['@-10-20', 0, 7], // N1 §4.1.5: years must be present
      ['@T', 0, 2],
      ['@T1', 0, 3],
      ['@Tx', 0, 2],
      ['@t14', 0, 1], // case-sensitive
      // A digit or ':' right after a literal is a malformed literal.
      ['@20150', 0, 6],
      ['@2015-01-011', 0, 12],
      ['@2015-01-01T1', 0, 13],
      ['@2015-01-01T14:3', 0, 16],
      ['@T14:345', 0, 8],
      ['@T14:', 0, 5],
      ['@2015-01-01T14:34:28+09:0', 0, 25],
      ['@2015-01-01T14:34:28+9:00', 0, 25],
      ['@2015-01-01T10:00:00+01:00:00', 0, 29],
      ['@T14:34:28Z1', 0, 12],
      ['a = @2015-02-04T14:3', 4, 20],
    ])('rejects the malformed literal %s', (expression, start, end) => {
      expectError(expression, 'syntax/invalid-date-literal', start, end);
    });
  });

  // https://hl7.org/fhirpath/N1/#environment-variables
  describe('environment variables (N1 §9)', () => {
    it.each([
      ['%ucum', 'ucum'],
      ['%context', 'context'],
      ['%_x1', '_x1'],
      ['%in', 'in'], // a keyword that is also an identifier
      ['%`us-zip`', 'us-zip'],
      ['%`vs-administrative-gender`', 'vs-administrative-gender'], // testVariables4
      ['%`ext-patient-birthTime`', 'ext-patient-birthTime'], // testExtension2
      ["%'us-zip'", 'us-zip'], // the string form, for backwards compatibility
      ['%"vs-name"', 'vs-name'], // the double-quoted form from the FHIR pages
      [String.raw`%'a\'b'`, "a'b"],
      [String.raw`%"a\"b"`, 'a"b'],
      ['%`a\\u0062`', 'ab'],
      ['%""', ''],
    ])('%s', (expression, name) => {
      expect(tokenize(expression)).toEqual([
        { kind: 'EnvironmentVariable', start: 0, end: expression.length, value: name },
        { kind: 'EOF', start: expression.length, end: expression.length, value: '' },
      ]);
    });

    it('ends a simple name at the first character that is not part of an identifier', () => {
      expect(lex("%ucum='x'")).toEqual([
        ['EnvironmentVariable', 'ucum'],
        ['=', '='],
        ['String', 'x'],
      ]);
      expect(lex('%resource.id')).toEqual([
        ['EnvironmentVariable', 'resource'],
        ['.', '.'],
        ['Identifier', 'id'],
      ]);
    });

    it.each(['%', '% ucum', '%1', '%$this', '%%x', '%.'])('rejects %j', (expression) => {
      expectError(expression, 'syntax/unexpected-character', 0, 1);
    });

    it.each([
      ["%'us-zip", 1, 8],
      ['%"vs-name', 1, 9],
      ['%`us-zip', 1, 8],
      [`%"a'`, 1, 4], // a single quote does not close a double-quoted name
    ])('rejects the unterminated name in %s', (expression, start, end) => {
      expectError(expression, 'syntax/unterminated-string', start, end);
    });

    it('accepts double quotes only after %', () => {
      expectError('"vs-name"', 'syntax/unexpected-character', 0, 1);
      expect(lexError('"vs-name"').message).toContain('single quotes');
    });
  });

  // https://hl7.org/fhirpath/N1/#functions and https://hl7.org/fhirpath/N1/#aggregate
  describe('special variables', () => {
    it.each([
      ['$this', '$this'],
      ['$index', '$index'],
      ['$total', '$total'],
    ] as const)('%s', (expression, kind) => {
      expect(lex(expression)).toEqual([[kind, expression]]);
    });

    it('lexes the special variables in an expression (testAggregate1)', () => {
      expect(lex('aggregate($this+$total, 0)').map(([kind]) => kind)).toEqual([
        'Identifier',
        '(',
        '$this',
        '+',
        '$total',
        ',',
        'Number',
        ')',
      ]);
    });

    it.each([
      ['$', 0, 1],
      ['$foo', 0, 4],
      ['$thisx', 0, 6],
      ['$This', 0, 5],
      ['$1', 0, 2],
      ['x.$ this', 2, 3],
    ])('rejects %j', (expression, start, end) => {
      expectError(expression, 'syntax/unexpected-character', start, end);
    });
  });

  describe('unexpected characters', () => {
    it.each([
      ['#', 0, 1],
      ['^', 0, 1],
      [';', 0, 1],
      ['?', 0, 1],
      [':', 0, 1],
      ['\\', 0, 1],
      ['a b ? c', 4, 5],
      ['\u0000', 0, 1],
      ['\u007f', 0, 1],
      ['é', 0, 1],
      ['😀', 0, 2], // a surrogate pair is one character
      ['\ud83d', 0, 1], // a lone surrogate
      ['a😀b', 1, 3],
    ])('rejects %j', (expression, start, end) => {
      expectError(expression, 'syntax/unexpected-character', start, end);
    });

    it.each([
      ['#', "'#' (U+0023)"],
      ['😀', "'😀' (U+1F600)"],
      ['\u0007', 'U+0007'],
      ['\u0085', 'U+0085'],
      ['\ud83d', 'U+D83D'],
    ])('names the character %j and its code point', (expression, description) => {
      expect(lexError(expression).message).toBe(`Unexpected character ${description}`);
    });
  });

  describe('trivia', () => {
    const expression = 'a /* b */ // c\n.d';

    it('skips whitespace and comments by default', () => {
      expect(lex(expression)).toEqual([
        ['Identifier', 'a'],
        ['.', '.'],
        ['Identifier', 'd'],
      ]);
      expect(lex(expression, { includeTrivia: false })).toEqual(lex(expression));
    });

    it('keeps them with includeTrivia', () => {
      expect(tokenize(expression, { includeTrivia: true })).toEqual([
        { kind: 'Identifier', start: 0, end: 1, value: 'a' },
        { kind: 'Whitespace', start: 1, end: 2, value: ' ' },
        { kind: 'BlockComment', start: 2, end: 9, value: '/* b */' },
        { kind: 'Whitespace', start: 9, end: 10, value: ' ' },
        { kind: 'LineComment', start: 10, end: 14, value: '// c' },
        { kind: 'Whitespace', start: 14, end: 15, value: '\n' },
        { kind: '.', start: 15, end: 16, value: '.' },
        { kind: 'Identifier', start: 16, end: 17, value: 'd' },
        { kind: 'EOF', start: 17, end: 17, value: '' },
      ]);
    });

    it('joins a run of whitespace into one token', () => {
      expect(lex(' \t\r\n a', { includeTrivia: true })).toEqual([
        ['Whitespace', ' \t\r\n '],
        ['Identifier', 'a'],
      ]);
    });

    it('covers the whole expression, so tools can rebuild it', () => {
      const source =
        "Patient.name.where(use = 'official' /* x */)\n  .given // y\r\n  | %`vs-a` | @2015T | $this[0]";
      const tokens = tokenize(source, { includeTrivia: true });
      expect(tokens.map((token) => source.slice(token.start, token.end)).join('')).toBe(source);
      for (const [index, token] of tokens.entries()) {
        expect(token.start).toBe(index === 0 ? 0 : tokens[index - 1]?.end);
      }
    });
  });

  describe('errors', () => {
    it.each([
      // [expression, code, line, column]
      ["name\n  .where(use = 'off", 'syntax/unterminated-string', 2, 16],
      ['name.given\r\n.first()\r\n#', 'syntax/unexpected-character', 3, 1],
      ['a\rb\r#', 'syntax/unexpected-character', 3, 1],
      ['a\n\n  /* open', 'syntax/unterminated-comment', 3, 3],
      ["'a\nb\\q'", 'syntax/invalid-escape', 2, 2],
      ['x\n\t@T1', 'syntax/invalid-date-literal', 2, 2],
    ] as const)('reports %j at the right line and column', (expression, code, line, column) => {
      const error = lexError(expression);
      expect(error.code).toBe(code);
      expect(error.span).toMatchObject({ line, column });
      expect(error.expression).toBe(expression);
    });

    it('formats the error with a caret under the span', () => {
      expect(lexError("Patient.name.where(use = 'official").format()).toBe(
        [
          "FhirPathSyntaxError [syntax/unterminated-string]: Unterminated string: expected a closing ' before the end of the expression",
          "  Patient.name.where(use = 'official",
          '                           ^^^^^^^^^',
        ].join('\n'),
      );
    });

    it('reports the first problem only', () => {
      expectError("'\\q' #", 'syntax/invalid-escape', 1, 3);
    });
  });
});
