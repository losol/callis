/**
 * UTF-16 code units the lexer switches on, and the character classes of the grammar.
 *
 * Import the module as a namespace (`import * as char from './char-codes.ts'`) so uses read as
 * `char.dot`. `String.prototype.charCodeAt` returns `NaN` past the end of a string; every check
 * below is false for `NaN`, so callers can look ahead without a bounds check.
 *
 * @see https://hl7.org/fhirpath/N1/grammar.html
 */

export const tab = 0x09;
export const lineFeed = 0x0a;
export const carriageReturn = 0x0d;
export const space = 0x20;
export const exclamation = 0x21;
export const doubleQuote = 0x22;
export const dollar = 0x24;
export const percent = 0x25;
export const ampersand = 0x26;
export const singleQuote = 0x27;
export const openParen = 0x28;
export const closeParen = 0x29;
export const asterisk = 0x2a;
export const plus = 0x2b;
export const comma = 0x2c;
export const minus = 0x2d;
export const dot = 0x2e;
export const slash = 0x2f;
export const digit0 = 0x30;
export const digit9 = 0x39;
export const colon = 0x3a;
export const lessThan = 0x3c;
export const equals = 0x3d;
export const greaterThan = 0x3e;
export const at = 0x40;
export const upperA = 0x41;
export const upperF = 0x46;
export const upperT = 0x54;
export const upperZ = 0x5a;
export const openBracket = 0x5b;
export const backslash = 0x5c;
export const closeBracket = 0x5d;
export const underscore = 0x5f;
export const backtick = 0x60;
export const lowerA = 0x61;
export const lowerF = 0x66;
export const lowerN = 0x6e;
export const lowerR = 0x72;
export const lowerT = 0x74;
export const lowerU = 0x75;
export const lowerZ = 0x7a;
export const openBrace = 0x7b;
export const pipe = 0x7c;
export const closeBrace = 0x7d;
export const tilde = 0x7e;

/** `[0-9]` */
export function isDigit(code: number): boolean {
  return code >= digit0 && code <= digit9;
}

/** The first character of a simple identifier: `[A-Za-z_]`. */
export function isIdentifierStart(code: number): boolean {
  return (
    (code >= lowerA && code <= lowerZ) || (code >= upperA && code <= upperZ) || code === underscore
  );
}

/** A later character of a simple identifier: `[A-Za-z0-9_]`. */
export function isIdentifierPart(code: number): boolean {
  return isIdentifierStart(code) || isDigit(code);
}

/** Whitespace as the grammar defines it: tab, line feed, carriage return and space. */
export function isWhitespace(code: number): boolean {
  return code === space || code === tab || code === lineFeed || code === carriageReturn;
}

/** The value of a hexadecimal digit `[0-9a-fA-F]`, or -1 if `code` is not one. */
export function hexDigitValue(code: number): number {
  if (isDigit(code)) {
    return code - digit0;
  }
  if (code >= lowerA && code <= lowerF) {
    return code - lowerA + 10;
  }
  if (code >= upperA && code <= upperF) {
    return code - upperA + 10;
  }
  return -1;
}

/** A UTF-16 high (leading) surrogate. */
export function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** A UTF-16 low (trailing) surrogate. */
export function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
