import type { SyntaxErrorCode } from '../errors/error-codes.ts';
import { FhirPathSyntaxError } from '../errors/fhirpath-error.ts';
import * as char from './char-codes.ts';
import { LineTable } from './line-table.ts';
import type { SymbolKind, Token, TokenKind, TriviaKind } from './token.ts';

/** Options for {@link tokenize}. */
export interface LexerOptions {
  /**
   * Keep whitespace and comments as `Whitespace`, `LineComment` and `BlockComment` tokens, for
   * tools such as formatters and syntax highlighters. The tokens then cover the whole expression
   * without gaps. Defaults to `false`.
   */
  readonly includeTrivia?: boolean;
}

/**
 * Splits a FHIRPath expression into tokens.
 *
 * The lexer reads the expression once, from left to right, and checks only the shape of each
 * token. Keywords are returned as identifiers, and literal values such as `@2015-02-30` are
 * validated later by the compiler. The result always ends with an `EOF` token.
 *
 * @throws {FhirPathSyntaxError} `syntax/unexpected-character`, `syntax/unterminated-string`,
 *   `syntax/unterminated-comment`, `syntax/invalid-escape` or `syntax/invalid-date-literal`, with
 *   the span of the problem.
 * @see https://hl7.org/fhirpath/N1/#lexical-elements
 * @see https://hl7.org/fhirpath/N1/grammar.html
 * @example
 * ```ts
 * tokenize("name.where(use = 'official')").map((token) => token.kind);
 * // ['Identifier', '.', 'Identifier', '(', 'Identifier', '=', 'String', ')', 'EOF']
 * ```
 */
export function tokenize(expression: string, options: LexerOptions = {}): readonly Token[] {
  return new Lexer(expression, options.includeTrivia === true).run();
}

const dateLiteralFormats =
  'a date (@YYYY, @YYYY-MM or @YYYY-MM-DD), a date and time (@YYYY-MM-DDThh:mm:ss.fff+hh:mm) or a time (@Thh:mm:ss.fff)';

/** The state of one {@link tokenize} call. */
class Lexer {
  readonly #source: string;
  readonly #includeTrivia: boolean;
  /** The offset of the next character to read. */
  #pos = 0;

  constructor(source: string, includeTrivia: boolean) {
    this.#source = source;
    this.#includeTrivia = includeTrivia;
  }

  run(): readonly Token[] {
    const length = this.#source.length;
    const tokens: Token[] = [];
    while (this.#pos < length) {
      const token = this.#next();
      if (token !== undefined) {
        tokens.push(token);
      }
    }
    tokens.push({ kind: 'EOF', start: length, end: length, value: '' });
    return tokens;
  }

  /** Reads the token at the current position. Skipped trivia returns `undefined`. */
  #next(): Token | undefined {
    const source = this.#source;
    const start = this.#pos;
    const code = source.charCodeAt(start);
    switch (code) {
      case char.space:
      case char.tab:
      case char.lineFeed:
      case char.carriageReturn:
        return this.#whitespace(start);
      case char.slash:
        return this.#slash(start);
      case char.openParen:
        return this.#symbol('(', start, 1);
      case char.closeParen:
        return this.#symbol(')', start, 1);
      case char.openBracket:
        return this.#symbol('[', start, 1);
      case char.closeBracket:
        return this.#symbol(']', start, 1);
      case char.openBrace:
        return this.#symbol('{', start, 1);
      case char.closeBrace:
        return this.#symbol('}', start, 1);
      case char.dot:
        return this.#symbol('.', start, 1);
      case char.comma:
        return this.#symbol(',', start, 1);
      case char.equals:
        return this.#symbol('=', start, 1);
      case char.tilde:
        return this.#symbol('~', start, 1);
      case char.plus:
        return this.#symbol('+', start, 1);
      case char.minus:
        return this.#symbol('-', start, 1);
      case char.asterisk:
        return this.#symbol('*', start, 1);
      case char.pipe:
        return this.#symbol('|', start, 1);
      case char.ampersand:
        return this.#symbol('&', start, 1);
      case char.lessThan:
        return source.charCodeAt(start + 1) === char.equals
          ? this.#symbol('<=', start, 2)
          : this.#symbol('<', start, 1);
      case char.greaterThan:
        return source.charCodeAt(start + 1) === char.equals
          ? this.#symbol('>=', start, 2)
          : this.#symbol('>', start, 1);
      case char.exclamation:
        return this.#exclamation(start);
      case char.singleQuote:
        return this.#quotedToken('String', start);
      case char.backtick:
        return this.#quotedToken('DelimitedIdentifier', start);
      case char.at:
        return this.#dateTime(start);
      case char.dollar:
        return this.#specialVariable(start);
      case char.percent:
        return this.#environmentVariable(start);
      default:
        if (char.isIdentifierStart(code)) {
          return this.#token('Identifier', start, this.#identifierEnd(start + 1));
        }
        if (char.isDigit(code)) {
          return this.#number(start);
        }
        throw this.#unexpectedCharacter(start);
    }
  }

  /** A token for `[start, end)`. Moves the position to `end`. */
  #token(
    kind: TokenKind,
    start: number,
    end: number,
    value: string = this.#source.slice(start, end),
  ): Token {
    this.#pos = end;
    return { kind, start, end, value };
  }

  #symbol(kind: SymbolKind, start: number, length: number): Token {
    return this.#token(kind, start, start + length, kind);
  }

  /** A trivia token, or `undefined` if trivia is not kept. Moves the position to `end`. */
  #trivia(kind: TriviaKind, start: number, end: number): Token | undefined {
    if (!this.#includeTrivia) {
      this.#pos = end;
      return undefined;
    }
    return this.#token(kind, start, end);
  }

  // https://hl7.org/fhirpath/N1/#whitespace
  #whitespace(start: number): Token | undefined {
    let end = start + 1;
    while (char.isWhitespace(this.#source.charCodeAt(end))) {
      end++;
    }
    return this.#trivia('Whitespace', start, end);
  }

  /** `/`, or a comment. https://hl7.org/fhirpath/N1/#comments */
  #slash(start: number): Token | undefined {
    const source = this.#source;
    const next = source.charCodeAt(start + 1);
    if (next === char.slash) {
      // The line break after a line comment is whitespace, not part of the comment.
      let end = start + 2;
      while (end < source.length) {
        const code = source.charCodeAt(end);
        if (code === char.lineFeed || code === char.carriageReturn) {
          break;
        }
        end++;
      }
      return this.#trivia('LineComment', start, end);
    }
    if (next === char.asterisk) {
      const close = source.indexOf('*/', start + 2);
      if (close < 0) {
        throw this.#error(
          'syntax/unterminated-comment',
          "Unterminated comment: expected '*/' before the end of the expression",
          start,
          source.length,
        );
      }
      return this.#trivia('BlockComment', start, close + 2);
    }
    return this.#symbol('/', start, 1);
  }

  #exclamation(start: number): Token {
    const next = this.#source.charCodeAt(start + 1);
    if (next === char.equals) {
      return this.#symbol('!=', start, 2);
    }
    if (next === char.tilde) {
      return this.#symbol('!~', start, 2);
    }
    throw this.#error(
      'syntax/unexpected-character',
      "Unexpected character '!': expected '!=' or '!~'",
      start,
      start + 1,
    );
  }

  /** The end of the identifier characters `[A-Za-z0-9_]*` from `pos`. */
  #identifierEnd(pos: number): number {
    let end = pos;
    while (char.isIdentifierPart(this.#source.charCodeAt(end))) {
      end++;
    }
    return end;
  }

  #digitsEnd(pos: number): number {
    let end = pos;
    while (char.isDigit(this.#source.charCodeAt(end))) {
      end++;
    }
    return end;
  }

  /** `[0-9]+('.'[0-9]+)?` https://hl7.org/fhirpath/N1/#decimal */
  #number(start: number): Token {
    const source = this.#source;
    let end = this.#digitsEnd(start + 1);
    // A '.' belongs to the number only if a digit follows, so `1.toString()` is `1`, `.`,
    // `toString`.
    if (source.charCodeAt(end) === char.dot && char.isDigit(source.charCodeAt(end + 1))) {
      end = this.#digitsEnd(end + 2);
    }
    // TODO(T0028): read the `L` suffix of Long literals here.
    return this.#token('Number', start, end);
  }

  #quotedToken(kind: 'String' | 'DelimitedIdentifier', start: number): Token {
    const value = this.#quoted(start);
    return this.#token(kind, start, this.#pos, value);
  }

  /**
   * Reads a quoted string or delimited identifier whose opening quote is at `start`, and returns
   * its decoded text. Moves the position past the closing quote. Unescaped line breaks are
   * allowed, as in the grammar.
   *
   * @see https://hl7.org/fhirpath/N1/#string
   */
  #quoted(start: number): string {
    const source = this.#source;
    const quote = source.charCodeAt(start);
    let value = '';
    // The last decoded code unit, for the surrogate checks. It is tracked here because reading it
    // back from `value` would flatten the growing string on every escape, which is quadratic.
    let previous = Number.NaN;
    let chunkStart = start + 1;
    let pos = chunkStart;
    while (pos < source.length) {
      const code = source.charCodeAt(pos);
      if (code === quote) {
        this.#pos = pos + 1;
        return value + source.slice(chunkStart, pos);
      }
      if (code === char.backslash && pos + 1 < source.length) {
        if (pos > chunkStart) {
          value += source.slice(chunkStart, pos);
          previous = source.charCodeAt(pos - 1);
        }
        this.#pos = pos;
        const decoded = this.#escape(previous);
        value += decoded;
        previous = decoded.charCodeAt(decoded.length - 1);
        pos = this.#pos;
        chunkStart = pos;
      } else {
        pos++;
      }
    }
    const what = quote === char.backtick ? 'delimited identifier' : 'string';
    throw this.#error(
      'syntax/unterminated-string',
      `Unterminated ${what}: expected a closing ${String.fromCharCode(quote)} before the end of the expression`,
      start,
      source.length,
    );
  }

  /**
   * Decodes the escape sequence whose backslash is at the current position, and moves past it.
   * `previous` is the decoded code unit before the escape, used to check surrogate pairs.
   *
   * Only the escapes of N1 §4.1.2 are recognized, plus `\/` from the grammar. N1 says the
   * backslash of any other sequence is ignored, but the suite treats `'\u+041'` as a syntax error
   * (testLiteralUnicodeInvalid), so Callis rejects them all; see docs/spec-notes.md.
   *
   * @see https://hl7.org/fhirpath/N1/#string
   */
  #escape(previous: number): string {
    const source = this.#source;
    const start = this.#pos;
    const code = source.charCodeAt(start + 1);
    let decoded: string;
    switch (code) {
      case char.singleQuote:
        decoded = "'";
        break;
      case char.doubleQuote:
        decoded = '"';
        break;
      case char.backtick:
        decoded = '`';
        break;
      case char.backslash:
        decoded = '\\';
        break;
      case char.slash:
        decoded = '/';
        break;
      case char.lowerF:
        decoded = '\f';
        break;
      case char.lowerN:
        decoded = '\n';
        break;
      case char.lowerR:
        decoded = '\r';
        break;
      case char.lowerT:
        decoded = '\t';
        break;
      case char.lowerU:
        return this.#unicodeEscape(previous);
      default: {
        const codePoint = source.codePointAt(start + 1) ?? code;
        const end = start + 1 + (codePoint > 0xffff ? 2 : 1);
        throw this.#error(
          'syntax/invalid-escape',
          `Invalid escape sequence '${source.slice(start, end)}': expected one of \\' \\" \\\` \\\\ \\/ \\f \\n \\r \\t or \\uXXXX`,
          start,
          end,
        );
      }
    }
    this.#pos = start + 2;
    return decoded;
  }

  /**
   * Decodes `\uXXXX` at the current position. FHIRPath 3.0.0 requires an escaped surrogate to be
   * part of a pair, so a high surrogate must be followed by a low one and the other way round.
   *
   * @see https://hl7.org/fhirpath/STU3/#string
   */
  #unicodeEscape(previous: number): string {
    const source = this.#source;
    const start = this.#pos;
    const unit = this.#hex4(start + 2);
    if (unit < 0) {
      let end = start + 2;
      while (end < start + 6 && char.hexDigitValue(source.charCodeAt(end)) >= 0) {
        end++;
      }
      throw this.#error(
        'syntax/invalid-escape',
        `Invalid escape sequence '${source.slice(start, end)}': expected \\u and four hexadecimal digits`,
        start,
        end,
      );
    }
    const end = start + 6;
    const isUnpaired = char.isHighSurrogate(unit)
      ? !this.#startsWithLowSurrogate(end)
      : char.isLowSurrogate(unit) && !char.isHighSurrogate(previous);
    if (isUnpaired) {
      throw this.#error(
        'syntax/invalid-escape',
        `Invalid escape sequence '${source.slice(start, end)}': a surrogate must be part of a high and low surrogate pair`,
        start,
        end,
      );
    }
    this.#pos = end;
    return String.fromCharCode(unit);
  }

  /** The value of four hexadecimal digits at `pos`, or -1 if they are not there. */
  #hex4(pos: number): number {
    let value = 0;
    for (let index = pos; index < pos + 4; index++) {
      const digit = char.hexDigitValue(this.#source.charCodeAt(index));
      if (digit < 0) {
        return -1;
      }
      value = value * 16 + digit;
    }
    return value;
  }

  /** Whether a low surrogate starts at `pos`, either as a character or as a `\uXXXX` escape. */
  #startsWithLowSurrogate(pos: number): boolean {
    const source = this.#source;
    const code = source.charCodeAt(pos);
    return (
      char.isLowSurrogate(code) ||
      (code === char.backslash &&
        source.charCodeAt(pos + 1) === char.lowerU &&
        char.isLowSurrogate(this.#hex4(pos + 2)))
    );
  }

  /**
   * Reads a Date, DateTime or Time literal. Only the shape is checked: `@2015-02-30` is a `Date`
   * token, and the compiler validates the value.
   *
   * As with the grammar's tokens, the literal is the longest prefix with a valid shape. In
   * `@2015-02-04T14:34:28.is(DateTime)` the `.` has no digit after it, so it ends the literal, and
   * `@2015-1` is `@2015`, `-`, `1`.
   *
   * @see https://hl7.org/fhirpath/N1/#date
   * @see https://hl7.org/fhirpath/N1/#datetime
   * @see https://hl7.org/fhirpath/N1/#time
   */
  #dateTime(start: number): Token {
    const source = this.#source;
    let kind: 'Date' | 'DateTime' | 'Time';
    let end: number;
    if (source.charCodeAt(start + 1) === char.upperT) {
      // TIME: '@' 'T' TIMEFORMAT
      const timeEnd = this.#timeEnd(start + 2);
      if (timeEnd < 0) {
        throw this.#invalidDateLiteral(start, this.#dateLikeEnd(start + 2));
      }
      // The grammar has no time zone on a Time literal, but the suite expects `@T14:34:28Z` to
      // fail at evaluation (testLiteralTimeUTC), so the lexer reads it and the compiler rejects it.
      kind = 'Time';
      end = this.#timeZoneEnd(timeEnd);
    } else if (this.#isDigits(start + 1, 4)) {
      // DATE: '@' DATEFORMAT
      // DATETIME: '@' DATEFORMAT 'T' (TIMEFORMAT TIMEZONEOFFSETFORMAT?)?
      kind = 'Date';
      end = start + 5;
      if (this.#isSeparatedDigits(end, char.minus)) {
        end += 3;
        if (this.#isSeparatedDigits(end, char.minus)) {
          end += 3;
        }
      }
      if (source.charCodeAt(end) === char.upperT) {
        kind = 'DateTime';
        end++;
        const timeEnd = this.#timeEnd(end);
        if (timeEnd >= 0) {
          end = this.#timeZoneEnd(timeEnd);
        }
      }
    } else {
      throw this.#invalidDateLiteral(start, this.#dateLikeEnd(start + 1));
    }
    // A digit or ':' right after the literal can never be valid: the grammar would also end the
    // literal here and then fail on the rest. Reporting the whole literal gives a clearer error
    // for typos such as `@2015-01-01T14:3` or `@20150`.
    const junkEnd = this.#dateLikeEnd(end);
    if (char.isDigit(source.charCodeAt(end)) || source.slice(end, junkEnd).includes(':')) {
      throw this.#invalidDateLiteral(start, junkEnd);
    }
    return this.#token(kind, start, end);
  }

  /** The end of TIMEFORMAT, `hh(:mm(:ss('.'[0-9]+)?)?)?`, at `pos`; -1 if there is no `hh`. */
  #timeEnd(pos: number): number {
    if (!this.#isDigits(pos, 2)) {
      return -1;
    }
    let end = pos + 2;
    if (this.#isSeparatedDigits(end, char.colon)) {
      end += 3;
      if (this.#isSeparatedDigits(end, char.colon)) {
        end += 3;
        const source = this.#source;
        if (source.charCodeAt(end) === char.dot && char.isDigit(source.charCodeAt(end + 1))) {
          end = this.#digitsEnd(end + 2);
        }
      }
    }
    return end;
  }

  /** The end of TIMEZONEOFFSETFORMAT, `Z` or `(+|-)hh:mm`, at `pos`; `pos` if there is none. */
  #timeZoneEnd(pos: number): number {
    const code = this.#source.charCodeAt(pos);
    if (code === char.upperZ) {
      return pos + 1;
    }
    if (
      (code === char.plus || code === char.minus) &&
      this.#isDigits(pos + 1, 2) &&
      this.#isSeparatedDigits(pos + 3, char.colon)
    ) {
      return pos + 6;
    }
    return pos;
  }

  #isDigits(pos: number, count: number): boolean {
    for (let index = pos; index < pos + count; index++) {
      if (!char.isDigit(this.#source.charCodeAt(index))) {
        return false;
      }
    }
    return true;
  }

  /** Whether `separator` and two digits are at `pos`. */
  #isSeparatedDigits(pos: number, separator: number): boolean {
    return this.#source.charCodeAt(pos) === separator && this.#isDigits(pos + 1, 2);
  }

  /** The end of the characters from `pos` that can appear in a date literal, for error spans. */
  #dateLikeEnd(pos: number): number {
    const source = this.#source;
    let end = pos;
    for (;;) {
      const code = source.charCodeAt(end);
      if (
        !char.isDigit(code) &&
        code !== char.minus &&
        code !== char.plus &&
        code !== char.colon &&
        code !== char.dot
      ) {
        return end;
      }
      end++;
    }
  }

  #invalidDateLiteral(start: number, end: number): FhirPathSyntaxError {
    return this.#error(
      'syntax/invalid-date-literal',
      `Invalid date or time literal '${this.#source.slice(start, end)}': expected ${dateLiteralFormats}`,
      start,
      end,
    );
  }

  /** `$this`, `$index` or `$total`. https://hl7.org/fhirpath/N1/#functions */
  #specialVariable(start: number): Token {
    const end = this.#identifierEnd(start + 1);
    const text = this.#source.slice(start, end);
    switch (text) {
      case '$this':
      case '$index':
      case '$total':
        return this.#token(text, start, end, text);
      default:
        throw this.#error(
          'syntax/unexpected-character',
          `Expected $this, $index or $total but found '${text}'`,
          start,
          end,
        );
    }
  }

  /**
   * `%` and a name: an identifier, a delimited identifier or a string. The string form is allowed
   * for backwards compatibility (N1 §9). The double-quoted form `%"vs-name"` from the FHIR pages is
   * also accepted; see docs/spec-notes.md.
   *
   * @see https://hl7.org/fhirpath/N1/#environment-variables
   */
  #environmentVariable(start: number): Token {
    const source = this.#source;
    const nameStart = start + 1;
    const code = source.charCodeAt(nameStart);
    if (char.isIdentifierStart(code)) {
      const end = this.#identifierEnd(nameStart + 1);
      return this.#token('EnvironmentVariable', start, end, source.slice(nameStart, end));
    }
    if (code === char.backtick || code === char.singleQuote || code === char.doubleQuote) {
      const value = this.#quoted(nameStart);
      return this.#token('EnvironmentVariable', start, this.#pos, value);
    }
    throw this.#error(
      'syntax/unexpected-character',
      "Expected a variable name after '%': an identifier, a delimited identifier or a string",
      start,
      nameStart,
    );
  }

  #unexpectedCharacter(start: number): FhirPathSyntaxError {
    const codePoint = this.#source.codePointAt(start) ?? 0;
    const hint = codePoint === char.doubleQuote ? '; strings are enclosed in single quotes' : '';
    return this.#error(
      'syntax/unexpected-character',
      `Unexpected character ${describeCharacter(codePoint)}${hint}`,
      start,
      start + (codePoint > 0xffff ? 2 : 1),
    );
  }

  #error(code: SyntaxErrorCode, message: string, start: number, end: number): FhirPathSyntaxError {
    const source = this.#source;
    return new FhirPathSyntaxError(code, message, {
      expression: source,
      span: new LineTable(source).span(start, end),
    });
  }
}

/** A character for an error message: quoted if it prints, and always with its code point. */
function describeCharacter(codePoint: number): string {
  const hex = `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
  const character = String.fromCodePoint(codePoint);
  return invisibleCharacter.test(character) ? hex : `'${character}' (${hex})`;
}

/**
 * Separators, control and format characters, lone surrogates and other characters that do not
 * print visibly. Only used on the error path, so a regular expression is fine here.
 */
const invisibleCharacter = /^[\p{Z}\p{C}]$/u;
