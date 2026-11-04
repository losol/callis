import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FhirPathSyntaxError } from '../errors/fhirpath-error.ts';
import { spanFromOffsets } from '../errors/source-span.ts';
import { tokenize } from './lexer.ts';
import type { Token, TokenKind } from './token.ts';

// Property-based tests: the lexer never crashes, and its tokens are always well formed. On a
// failure fast-check prints the seed and the shrunk input; add that input to lexer.test.ts.

const backslash = '\\';
const unicodeEscape = `${backslash}u`;

/** Pieces of FHIRPath syntax, so that random input reaches every branch of the lexer. */
const fragments = [
  // Quotes and escapes.
  "'",
  '`',
  '"',
  backslash,
  `${backslash}'`,
  `${backslash}n`,
  `${backslash}q`,
  unicodeEscape,
  `${unicodeEscape}0041`,
  `${unicodeEscape}D83D`,
  `${unicodeEscape}DE00`,
  `${unicodeEscape}00`,
  String.fromCharCode(0xd83d),
  String.fromCharCode(0xde00),
  // Date and time literals.
  '@',
  '@T',
  '@2015',
  '-01',
  'T',
  '14',
  ':30',
  '.5',
  'Z',
  '+01:00',
  '-05:00',
  ':',
  // Numbers and identifiers.
  '0',
  '1',
  '9',
  '.',
  'a',
  'name',
  'div',
  '_x',
  // Symbols.
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  '=',
  '!',
  '!=',
  '~',
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
  // Variables.
  '%',
  '%ucum',
  '$',
  '$this',
  '$index',
  '$total',
  // Trivia.
  ' ',
  '\t',
  '\n',
  '\r',
  '//',
  '/*',
  '*/',
  // Characters the grammar does not allow.
  '#',
  ';',
  'é',
  String.fromCodePoint(0x1f600),
  String.fromCharCode(0),
];

const fragmentStrings = fc.string({ unit: fc.constantFrom(...fragments), maxLength: 40 });

const inputs = fc.oneof(
  fragmentStrings,
  // Start inside a string, a delimited identifier, a comment or a date literal, where most of the
  // error paths are.
  fc
    .tuple(fc.constantFrom("'", '`', '%"', '/*', '@', '@T', '@2015-01-01T'), fragmentStrings)
    .map(([prefix, rest]) => prefix + rest),
  fc.string({ unit: 'binary', maxLength: 40 }),
);

const lexerErrorCodes: ReadonlySet<string> = new Set([
  'syntax/unexpected-character',
  'syntax/unterminated-string',
  'syntax/unterminated-comment',
  'syntax/invalid-escape',
  'syntax/invalid-date-literal',
]);

/** Kinds whose value is decoded rather than copied from the source. */
const decodedKinds: ReadonlySet<TokenKind> = new Set([
  'String',
  'DelimitedIdentifier',
  'EnvironmentVariable',
  'EOF',
]);

const triviaKinds: ReadonlySet<TokenKind> = new Set(['Whitespace', 'LineComment', 'BlockComment']);

/** The tokens, or the syntax error. Any other error is rethrown and fails the property. */
function attempt(source: string, includeTrivia: boolean): readonly Token[] | FhirPathSyntaxError {
  try {
    return tokenize(source, { includeTrivia });
  } catch (error) {
    if (error instanceof FhirPathSyntaxError) {
      return error;
    }
    throw error;
  }
}

function expectWellFormedError(source: string, error: FhirPathSyntaxError): void {
  expect(lexerErrorCodes).toContain(error.code);
  expect(error.expression).toBe(source);
  const span = error.span;
  expect(span).toBeDefined();
  if (span !== undefined) {
    expect(span.start).toBeGreaterThanOrEqual(0);
    expect(span.end).toBeGreaterThan(span.start);
    expect(span.end).toBeLessThanOrEqual(source.length);
    expect(span).toEqual(spanFromOffsets(source, span.start, span.end));
  }
}

function expectWellFormedTokens(source: string, tokens: readonly Token[]): void {
  expect(tokens.at(-1)).toEqual({
    kind: 'EOF',
    start: source.length,
    end: source.length,
    value: '',
  });
  let previousEnd = 0;
  for (const token of tokens.slice(0, -1)) {
    expect(token.start).toBeGreaterThanOrEqual(previousEnd);
    expect(token.end).toBeGreaterThan(token.start);
    if (!decodedKinds.has(token.kind)) {
      expect(token.value).toBe(source.slice(token.start, token.end));
    }
    previousEnd = token.end;
  }
  expect(previousEnd).toBeLessThanOrEqual(source.length);
}

/** Writes `text` as a FHIRPath string literal, escaping only what must be escaped. */
function quote(text: string): string {
  return `'${text.replaceAll(backslash, backslash + backslash).replaceAll("'", `${backslash}'`)}'`;
}

/** Writes `text` as a FHIRPath string literal with every UTF-16 code unit as a `\uXXXX` escape. */
function quoteAsUnicodeEscapes(text: string): string {
  let escaped = '';
  for (let index = 0; index < text.length; index++) {
    escaped += unicodeEscape + text.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return `'${escaped}'`;
}

describe('tokenize (fuzzing)', () => {
  it('returns well-formed tokens or throws a FhirPathSyntaxError, and never crashes', () => {
    fc.assert(
      fc.property(inputs, (source) => {
        const result = attempt(source, false);
        if (result instanceof FhirPathSyntaxError) {
          expectWellFormedError(source, result);
        } else {
          expectWellFormedTokens(source, result);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('covers the whole input with includeTrivia, and otherwise only drops the trivia', () => {
    fc.assert(
      fc.property(inputs, (source) => {
        const withTrivia = attempt(source, true);
        const withoutTrivia = attempt(source, false);
        if (withTrivia instanceof FhirPathSyntaxError) {
          expect(withoutTrivia).toBeInstanceOf(FhirPathSyntaxError);
          if (withoutTrivia instanceof FhirPathSyntaxError) {
            expect([withTrivia.code, withTrivia.span]).toEqual([
              withoutTrivia.code,
              withoutTrivia.span,
            ]);
          }
          return;
        }
        let offset = 0;
        for (const token of withTrivia) {
          expect(token.start).toBe(offset);
          offset = token.end;
        }
        expect(offset).toBe(source.length);
        expect(withoutTrivia).toEqual(withTrivia.filter((token) => !triviaKinds.has(token.kind)));
      }),
      { numRuns: 2000 },
    );
  });

  // https://hl7.org/fhirpath/N1/#string
  it('reads back any text written as a string literal', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 40 }), (text) => {
        for (const literal of [quote(text), quoteAsUnicodeEscapes(text)]) {
          expect(tokenize(literal)).toEqual([
            { kind: 'String', start: 0, end: literal.length, value: text },
            { kind: 'EOF', start: literal.length, end: literal.length, value: '' },
          ]);
        }
      }),
      { numRuns: 500 },
    );
  });
});
