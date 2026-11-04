import type { SourceSpan } from '../errors/source-span.ts';
import * as char from './char-codes.ts';

/** A 1-based line and column. Columns count UTF-16 code units, so a tab counts as one. */
export interface LineColumn {
  readonly line: number;
  readonly column: number;
}

/**
 * The start offset of every line in an expression, for turning offsets into lines and columns.
 *
 * Tokens and AST nodes store offsets only. Build a table when a line or column is needed, for
 * example to report an error; one table answers any number of lookups in O(log lines).
 *
 * Line breaks are `\n`, `\r\n` or a lone `\r`, and a `\r\n` pair counts as one break, the same
 * rules as `spanFromOffsets` in `errors/source-span.ts`.
 */
export class LineTable {
  /** Ascending; the first line starts at 0. */
  readonly #lineStarts: readonly number[];

  constructor(source: string) {
    const lineStarts = [0];
    for (let index = 0; index < source.length; index++) {
      const code = source.charCodeAt(index);
      if (
        code === char.lineFeed ||
        (code === char.carriageReturn && source.charCodeAt(index + 1) !== char.lineFeed)
      ) {
        lineStarts.push(index + 1);
      }
    }
    this.#lineStarts = lineStarts;
  }

  /** The number of lines. An empty expression has one line. */
  get lineCount(): number {
    return this.#lineStarts.length;
  }

  /**
   * The line and column of an offset. An offset past the end of the expression is placed on the
   * last line, after its end.
   */
  locate(offset: number): LineColumn {
    const lineStarts = this.#lineStarts;
    // Find the last line that starts at or before the offset.
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      if ((lineStarts[middle] ?? 0) <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return { line: low + 1, column: offset - (lineStarts[low] ?? 0) + 1 };
  }

  /** A {@link SourceSpan} for `[start, end)`, with the line and column of `start`. */
  span(start: number, end: number = start): SourceSpan {
    const { line, column } = this.locate(start);
    return { start, end, line, column };
  }
}
