import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FhirPathSyntaxError } from '../errors/fhirpath-error.ts';
import { printAst } from './ast-printer.test-support.ts';
import { parse } from './parser.ts';

// https://hl7.org/fhirpath/N1/#operator-precedence
// Every adjacent precedence pair, in both source orders where applicable.
describe('precedence and associativity', () => {
  it.each([
    ['a[0].b', '(. ([] a 0) b)'],
    ['a.b[0]', '([] (. a b) 0)'],
    ['-a[0]', '(- ([] a 0))'],
    ['-a * b', '(* (- a) b)'],
    ['a * -b', '(* a (- b))'],
    ['a + b * c', '(+ a (* b c))'],
    ['a * b + c', '(+ (* a b) c)'],
    ['a + b is T', '(is (+ a b) T)'],
    ['a is T + b', '(+ (is a T) b)'],
    ['a | b as T', '(| a (as b T))'],
    ['a as T | b', '(| (as a T) b)'],
    ['a < b | c', '(< a (| b c))'],
    ['a | b < c', '(< (| a b) c)'],
    ['a = b < c', '(= a (< b c))'],
    ['a < b = c', '(= (< a b) c)'],
    ['a in b = c', '(in a (= b c))'],
    ['a = b in c', '(in (= a b) c)'],
    ['a and b in c', '(and a (in b c))'],
    ['a in b and c', '(and (in a b) c)'],
    ['a or b and c', '(or a (and b c))'],
    ['a and b xor c', '(xor (and a b) c)'],
    ['a implies b or c', '(implies a (or b c))'],
    ['a or b implies c', '(implies (or a b) c)'],
    ['-7.combine(3)', '(- (call 7 combine 3))'],
    ['x as Quantity.unit', '(as x Quantity.unit)'],
    ['(x as Quantity).unit', '(. (as x Quantity) unit)'],
    ['a is T as U', '(as (is a T) U)'],
    ['a - b + c & d', '(& (+ (- a b) c) d)'],
    ['a or b xor c', '(xor (or a b) c)'],
    ['--+a', '(- (- (+ a)))'],
  ])('%s', (source, expected) => expect(printAst(parse(source))).toBe(expected));

  it.each([
    '*',
    '/',
    'div',
    'mod',
    '+',
    '-',
    '&',
    '|',
    '<',
    '>',
    '<=',
    '>=',
    '=',
    '~',
    '!=',
    '!~',
    'in',
    'contains',
    'and',
    'or',
    'xor',
    'implies',
  ])('associates %s to the left', (op) => {
    expect(printAst(parse(`a ${op} b ${op} c`))).toBe(`(${op} (${op} a b) c)`);
  });
});

// https://hl7.org/fhirpath/N1/grammar.html (term, invocation, paramList, typeSpecifier)
describe('terms and invocations', () => {
  it.each([
    ['foo()', '(call _ foo)'],
    ["'abc'.contains('b')", "(call 'abc' contains 'b')"],
    ['a.f(b, c.g(), d[1 + 2])', '(call a f b (call c g) ([] d (+ 1 2)))'],
    ['is(FHIR.Patient)', '(call _ is (. FHIR Patient))'],
    ['as(T)', '(call _ as T)'],
    ['ofType(FHIR.Patient.contact)', '(call _ ofType (. (. FHIR Patient) contact))'],
    ['as.in.is.contains', '(. (. (. as in) is) contains)'],
    ['`div`.`and`()', '(call `div` and)'],
    ['constructor.__proto__.toString()', '(call (. constructor __proto__) toString)'],
    ['true', 'true'],
    ['false', 'false'],
    ['{}', '{}'],
    ['text.`div`.htmlChecks()', '(call (. text `div`) htmlChecks)'],
    ['8 div 2', '(div 8 2)'],
    ['a /* mid */ . b // trailing', '(. a b)'],
    ['%ucum', '(% "ucum")'],
    ["%'us-zip'", '(% "us-zip")'],
    ['%"vs-name"', '(% "vs-name")'],
    ['%`true`', '(% "true")'],
    ["%'true'", '(% "true")'],
    ['%is', '(% "is")'],
  ])('%s', (source, expected) => expect(printAst(parse(source))).toBe(expected));

  it.each(['this', 'index', 'total'])(
    'preserves bare and targeted $%s syntax without assigning semantics',
    (name) => {
      expect(parse(`$${name}`)).not.toHaveProperty('target');
      expect(printAst(parse(`a.$${name}[0].b`))).toBe(`(. ([] (. a $${name}) 0) b)`);
      expect(printAst(parse(`-a.$${name}`))).toBe(`(- (. a $${name}))`);
    },
  );

  it.each(['is', 'as'])('leaves invocation suffixes after %s for the expression parser', (op) => {
    expect(printAst(parse(`x ${op} T.f()`))).toBe(`(call (${op} x T) f)`);
    expect(printAst(parse(`x ${op} FHIR.Patient.f(a)[0].b`))).toBe(
      `(. ([] (call (${op} x FHIR.Patient) f a) 0) b)`,
    );
    expect(printAst(parse(`x ${op} T.\`f\`() + y`))).toBe(`(+ (call (${op} x T) f) y)`);
    expect(printAst(parse(`x ${op} T.unit`))).toBe(`(${op} x T.unit)`);
    for (const name of ['this', 'index', 'total']) {
      const source = `x ${op} FHIR.Patient.$${name}[0].b`;
      expect(printAst(parse(source))).toBe(`(. ([] (. (${op} x FHIR.Patient) $${name}) 0) b)`);
      const bareSuffix = `x ${op} T.$${name}`;
      expect(parse(bareSuffix)).toMatchObject({
        kind: name === 'this' ? 'This' : name === 'index' ? 'Index' : 'Total',
        span: { start: 0, end: bareSuffix.length },
        target: {
          kind: 'TypeOperation',
          op,
          span: { start: 0, end: 6 },
          type: { identifiers: ['T'], span: { start: 5, end: 6 } },
        },
      });
    }
    expect(parse(`x ${op} T.f()`)).toMatchObject({
      kind: 'FunctionCall',
      span: { start: 0, end: 10 },
      target: { kind: 'TypeOperation', type: { identifiers: ['T'], span: { start: 5, end: 6 } } },
    });
  });

  it('keeps type identifiers as written and separately spans the greedy type', () => {
    expect(parse('x as `fHiR`.`Patient.contact`')).toEqual({
      kind: 'TypeOperation',
      op: 'as',
      operand: { kind: 'Identifier', name: 'x', delimited: false, span: { start: 0, end: 1 } },
      type: {
        kind: 'TypeSpecifier',
        identifiers: ['fHiR', 'Patient.contact'],
        span: { start: 5, end: 29 },
      },
      span: { start: 0, end: 29 },
    });
  });
});

// https://hl7.org/fhirpath/N1/#literals and #quantity
// Values (including well-formed but invalid dates) are deliberately not constructed here.
describe('raw literals and spans', () => {
  it.each([
    ['001', 'Integer'],
    ['1.00', 'Decimal'],
    ['@2015-02-30', 'Date'],
    ['@2015T', 'DateTime'],
    ['@T14:34:28Z', 'Time'],
  ])('keeps %s untouched', (raw, type) => {
    expect(parse(raw)).toEqual({ kind: 'Literal', type, raw, span: { start: 0, end: raw.length } });
  });

  it('keeps decoded strings separate from raw and includes nested grouping in the span', () => {
    expect(parse(" (( 'a\\n\\u0062' )) ")).toEqual({
      kind: 'Literal',
      type: 'String',
      raw: "'a\\n\\u0062'",
      value: 'a\nb',
      span: { start: 1, end: 18 },
    });
  });

  it('keeps grouped quantity source, numeric precision, trivia and escaped unit separately', () => {
    const raw = "01.00 /* unit */ 'm\\u0067'";
    expect(parse(`((${raw}))`)).toEqual({
      kind: 'Literal',
      type: 'Quantity',
      raw,
      number: '01.00',
      unit: 'mg',
      span: { start: 0, end: raw.length + 4 },
    });
  });

  it.each([
    'year',
    'years',
    'month',
    'months',
    'week',
    'weeks',
    'day',
    'days',
    'hour',
    'hours',
    'minute',
    'minutes',
    'second',
    'seconds',
    'millisecond',
    'milliseconds',
  ])('recognizes the calendar unit %s', (unit) => {
    expect(parse(`1 ${unit}`)).toMatchObject({
      kind: 'Literal',
      type: 'Quantity',
      raw: `1 ${unit}`,
      number: '1',
      unit,
    });
  });

  it('spans operators, calls, indexes and UTF-16 text exactly', () => {
    expect(parse(" '😀'.f(1)[0] + x ")).toMatchObject({
      kind: 'Binary',
      span: { start: 1, end: 17 },
      left: {
        kind: 'Indexer',
        span: { start: 1, end: 13 },
        target: {
          kind: 'FunctionCall',
          span: { start: 1, end: 10 },
          target: { span: { start: 1, end: 5 } },
        },
      },
    });
  });
});

// https://hl7.org/fhirpath/N1/grammar.html
// Grammar errors are distinct from unknown functions, wrong arities and invalid literal values.
describe('syntax errors and limits', () => {
  it.each([
    '',
    '()',
    'a.',
    'a..b',
    'a[',
    'a[]',
    'a[1',
    'a[1,2]',
    'f(',
    'f(,a)',
    'f(a,)',
    'f(a b)',
    '(a',
    'a)',
    '{1}',
    '{}{}',
    '1 2',
    'x as',
    'x is true',
    'x as T.',
    'x as T()',
    'a +',
    '*a',
    'true()',
    'a.true',
    'text.div.htmlChecks()',
    'div',
    'and()',
    '%true',
    '%year',
    '1L',
    'T { a: 1 }',
    'a.$this()',
    'a `in` b',
  ])('rejects %j', (source) => {
    expect(() => parse(source)).toThrow(FhirPathSyntaxError);
  });

  it('names the expected delimiter and reports its exact multiline location', () => {
    try {
      parse('f(\r\n  (1)');
      expect.fail('expected syntax error');
    } catch (error) {
      expect(error).toBeInstanceOf(FhirPathSyntaxError);
      expect(error).toMatchObject({
        code: 'syntax/unexpected-token',
        span: { start: 9, end: 9, line: 2, column: 6 },
      });
      expect(String(error)).toContain("Expected ')'");
    }
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1001])(
    'rejects invalid maxDepth %s',
    (maxDepth) => {
      expect(() => parse('a', { maxDepth })).toThrowError(
        expect.objectContaining({ code: 'syntax/nesting-limit' }),
      );
    },
  );

  it('counts the root and permits callers to lower the nesting limit', () => {
    expect(() => parse('a', { maxDepth: 1 })).not.toThrow();
    expect(() => parse('(a)', { maxDepth: 1 })).toThrowError(
      expect.objectContaining({
        code: 'syntax/nesting-limit',
        span: { start: 1, end: 2, line: 1, column: 2 },
      }),
    );
    expect(() => parse('f(a)', { maxDepth: 2 })).not.toThrow();
  });

  it.each([
    (n: number) => `${'('.repeat(n)}a${')'.repeat(n)}`,
    (n: number) => `${'-'.repeat(n)}1`,
    (n: number) => `${'f('.repeat(n)}a${')'.repeat(n)}`,
    (n: number) => `${'a['.repeat(n)}0${']'.repeat(n)}`,
  ])('enforces the default depth without a native stack overflow', (source) => {
    expect(() => parse(source(999))).not.toThrow();
    expect(() => parse(source(1000))).toThrowError(
      expect.objectContaining({ code: 'syntax/nesting-limit' }),
    );
    expect(() => parse(source(10000))).toThrow(FhirPathSyntaxError);
  });

  it('handles long flat chains without consuming recursive nesting', () => {
    expect(() => parse(`a${'.b'.repeat(10000)}`)).not.toThrow();
    expect(() => parse(`a${' + b'.repeat(10000)}`)).not.toThrow();
    expect(() => parse(`a${'[0]'.repeat(10000)}`)).not.toThrow();
  });

  it('never crashes on bounded arbitrary text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (source) => {
        try {
          parse(source);
        } catch (error) {
          expect(error).toBeInstanceOf(FhirPathSyntaxError);
        }
      }),
      { numRuns: 1000, seed: 170002 },
    );
  });
});
