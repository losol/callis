/**
 * Strings as sequences of characters, for the string functions
 * ([N1 §5.6](https://hl7.org/fhirpath/N1/#string-manipulation)).
 *
 * A character is a Unicode scalar value, as FHIRPath 3.0.0 specifies for `indexOf()`,
 * `substring()`, `length()` and `toChars()`: a surrogate pair is one character, a combining mark
 * is another. JavaScript strings are UTF-16, so every position here is converted between
 * characters and UTF-16 code units. A string that is not well-formed UTF-16 (input data can hold
 * a lone surrogate; an expression cannot) counts each lone surrogate as one character, and a
 * search never matches half of a surrogate pair.
 *
 * @see https://hl7.org/fhirpath/STU3/en/#string-manipulation
 */

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Whether a surrogate pair starts at `offset`. An offset past the end is not a pair. */
function isPairAt(text: string, offset: number): boolean {
  return isHighSurrogate(text.charCodeAt(offset)) && isLowSurrogate(text.charCodeAt(offset + 1));
}

/** Whether `offset` lies between two characters rather than inside a surrogate pair. */
export function isBoundary(text: string, offset: number): boolean {
  return offset <= 0 || offset >= text.length || !isPairAt(text, offset - 1);
}

/** The number of characters in `text`, or before the UTF-16 offset `end`. */
export function characterCount(text: string, end: number = text.length): number {
  let count = 0;
  for (let offset = 0; offset < end; offset++) {
    count++;
    if (offset + 1 < end && isPairAt(text, offset)) {
      offset++;
    }
  }
  return count;
}

/**
 * The UTF-16 offset that is `count` characters after `offset`, or the end of `text` when there
 * are fewer. Stops at the end however large `count` is.
 */
export function advance(text: string, offset: number, count: number): number {
  let position = offset;
  for (let moved = 0; moved < count && position < text.length; moved++) {
    position += isPairAt(text, position) ? 2 : 1;
  }
  return position;
}

/** The characters of `text` as single-character strings. */
export function characters(text: string): string[] {
  // The string iterator yields a surrogate pair as one element and a lone surrogate on its own.
  return Array.from(text);
}

/**
 * The UTF-16 offset of the first occurrence of `search` at or after `from` that starts and ends
 * on character boundaries, or -1. An empty `search` occurs at `from`.
 */
export function findFrom(text: string, search: string, from: number): number {
  let offset = text.indexOf(search, from);
  while (offset !== -1 && !(isBoundary(text, offset) && isBoundary(text, offset + search.length))) {
    offset = text.indexOf(search, offset + 1);
  }
  return offset;
}

/** Whether `text` starts with `prefix`, character by character. */
export function startsWithCharacters(text: string, prefix: string): boolean {
  return text.startsWith(prefix) && isBoundary(text, prefix.length);
}

/** Whether `text` ends with `suffix`, character by character. */
export function endsWithCharacters(text: string, suffix: string): boolean {
  return text.endsWith(suffix) && isBoundary(text, text.length - suffix.length);
}

/**
 * `text` with every non-overlapping occurrence of `pattern` replaced by `substitution`, as
 * `replace()` does ([N1 §5.6.8](https://hl7.org/fhirpath/N1/#replacepattern-string-substitution-string-string)).
 * An empty `pattern` occurs before every character and at the end, so `substitution` surrounds
 * each character: `'abc'` becomes `'xaxbxcx'` for `'x'`.
 */
export function replaceAllCharacters(text: string, pattern: string, substitution: string): string {
  let result = '';
  if (pattern === '') {
    let position = 0;
    while (position < text.length) {
      const next = advance(text, position, 1);
      result += substitution + text.slice(position, next);
      position = next;
    }
    return result + substitution;
  }
  let last = 0;
  for (
    let offset = findFrom(text, pattern, 0);
    offset !== -1;
    offset = findFrom(text, pattern, last)
  ) {
    result += text.slice(last, offset) + substitution;
    last = offset + pattern.length;
  }
  return result + text.slice(last);
}
