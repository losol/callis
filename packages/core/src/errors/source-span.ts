/**
 * A location in an expression.
 *
 * `start` and `end` are offsets in UTF-16 code units; `end` is exclusive. `line` and `column`
 * describe `start` and are 1-based.
 */
export interface SourceSpan {
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
}

const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/**
 * Builds a {@link SourceSpan} for `source[start, end)` and computes the line and column of `start`.
 *
 * Line breaks are `\n`, `\r\n` or a lone `\r`. A `\r\n` pair counts as one break.
 */
export function spanFromOffsets(source: string, start: number, end: number = start): SourceSpan {
  let line = 1;
  let lineStart = 0;
  const limit = Math.min(start, source.length);
  for (let index = 0; index < limit; index++) {
    const char = source.charCodeAt(index);
    const isCrBeforeLf = char === CARRIAGE_RETURN && source.charCodeAt(index + 1) === LINE_FEED;
    if (char === LINE_FEED || (char === CARRIAGE_RETURN && !isCrBeforeLf)) {
      line++;
      lineStart = index + 1;
    }
  }
  return { start, end, line, column: start - lineStart + 1 };
}
