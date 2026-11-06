/** A simple unit (an optional prefix and an atom, not yet split) with its exponent. */
export interface SymbolComponent {
  readonly kind: 'symbol';
  readonly symbol: string;
  readonly exponent: number;
  readonly annotation: string | undefined;
}

/** A positive integer used as a unit, as in `10.L`; `2+10` raises it to a power (§9). */
export interface NumberComponent {
  readonly kind: 'number';
  readonly value: bigint;
  readonly exponent: number;
}

/** An annotation on its own, such as `{RBC}`, which means the unity `1`. */
export interface AnnotationComponent {
  readonly kind: 'annotation';
  readonly text: string;
}

/** A parenthesized term. */
export interface GroupComponent {
  readonly kind: 'group';
  readonly term: UnitTermSyntax;
}

/** One component of a term. */
export type UnitComponent =
  | SymbolComponent
  | NumberComponent
  | AnnotationComponent
  | GroupComponent;

/** A component with the operator before it: 1 for `.` (and the first), -1 for `/`. */
export interface UnitFactorSyntax {
  readonly operator: 1 | -1;
  readonly component: UnitComponent;
}

/** A term: components joined by `.` and `/`, evaluated from left to right. */
export interface UnitTermSyntax {
  readonly factors: readonly UnitFactorSyntax[];
}

/** Parentheses nested deeper than this are rejected, so parsing cannot exhaust the stack. */
export const MAX_GROUP_DEPTH = 32;

/** Characters that end a symbol outside square brackets. */
const DELIMITERS = new Set(['.', '/', '(', ')', '{', '}']);
const DIGITS = /^[0-9]+$/;

interface Cursor {
  index: number;
}

/**
 * Parses the syntax of a case-sensitive UCUM unit expression without looking up any symbol, so
 * `xyz` parses here and is rejected later. Whitespace and characters outside ASCII 33–126 are
 * invalid.
 *
 * @returns the term, or `undefined` if the text is not a syntactically valid unit expression.
 * @see https://ucum.org/ucum#section-Syntax-Rules
 */
export function parseUnitExpression(text: string): UnitTermSyntax | undefined {
  if (text.length === 0) return undefined;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x21 || code > 0x7e) return undefined;
  }
  // §7■3: a leading solidus inverts the unit that directly follows it.
  const leading = text.startsWith('/');
  const cursor: Cursor = { index: leading ? 1 : 0 };
  const term = parseTerm(text, cursor, leading ? -1 : 1, 0);
  return term !== undefined && cursor.index === text.length ? term : undefined;
}

function parseTerm(
  text: string,
  cursor: Cursor,
  first: 1 | -1,
  depth: number,
): UnitTermSyntax | undefined {
  const factors: UnitFactorSyntax[] = [];
  let operator = first;
  for (;;) {
    const component = parseComponent(text, cursor, depth);
    if (component === undefined) return undefined;
    factors.push({ operator, component });
    const next = text[cursor.index];
    if (next === '.') operator = 1;
    else if (next === '/') operator = -1;
    else return { factors };
    cursor.index++;
  }
}

function parseComponent(text: string, cursor: Cursor, depth: number): UnitComponent | undefined {
  const start = cursor.index;
  const first = text[start];
  if (first === '(') {
    if (depth >= MAX_GROUP_DEPTH) return undefined;
    cursor.index++;
    const term = parseTerm(text, cursor, 1, depth + 1);
    if (term === undefined || text[cursor.index] !== ')') return undefined;
    cursor.index++;
    return { kind: 'group', term };
  }
  if (first === '{') {
    const annotation = parseAnnotation(text, cursor);
    return annotation === undefined ? undefined : { kind: 'annotation', text: annotation };
  }
  // A symbol runs to the next delimiter; inside square brackets every character is part of it.
  let index = start;
  let brackets = 0;
  for (; index < text.length; index++) {
    const char = text.charAt(index);
    if (char === '[') brackets++;
    else if (char === ']') {
      if (brackets === 0) return undefined;
      brackets--;
    } else if (brackets === 0 && DELIMITERS.has(char)) break;
  }
  if (brackets !== 0 || index === start) return undefined;
  const run = text.slice(start, index);
  cursor.index = index;
  // §8: only a pure string of digits is a number.
  if (DIGITS.test(run)) return { kind: 'number', value: BigInt(run), exponent: 1 };
  const split = exponentStart(run);
  const symbol = run.slice(0, split);
  const exponent = split === run.length ? 1 : Number(run.slice(split));
  if (!Number.isSafeInteger(exponent)) return undefined;
  if (DIGITS.test(symbol)) {
    // §9: an explicit sign separates an exponent from a number, so `2+10` is 2^10.
    return { kind: 'number', value: BigInt(symbol), exponent };
  }
  let annotation: string | undefined;
  if (text[cursor.index] === '{') {
    annotation = parseAnnotation(text, cursor);
    if (annotation === undefined) return undefined;
  }
  return { kind: 'symbol', symbol, exponent, annotation };
}

/**
 * Where the exponent of a symbol starts: its trailing digits with an optional sign (§9), or the
 * end of the symbol if it has none. A linear scan, so long input cannot cause backtracking.
 */
function exponentStart(run: string): number {
  let start = run.length;
  while (start > 0 && isDigit(run.charCodeAt(start - 1))) start--;
  if (start === run.length) return run.length;
  const sign = run[start - 1];
  if (sign === '+' || sign === '-') start--;
  return start === 0 ? run.length : start;
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/** Reads `{…}` at the cursor; the text inside may not contain another curly brace. */
function parseAnnotation(text: string, cursor: Cursor): string | undefined {
  const end = text.indexOf('}', cursor.index + 1);
  if (end === -1) return undefined;
  const annotation = text.slice(cursor.index + 1, end);
  if (annotation.includes('{')) return undefined;
  cursor.index = end + 1;
  return annotation;
}
