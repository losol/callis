import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { spanFromOffsets } from '../errors/source-span.ts';
import { LineTable } from './line-table.ts';

describe('LineTable', () => {
  it.each([
    ['', 1],
    ['a', 1],
    ['a\n', 2],
    ['a\nb', 2],
    ['a\r\nb', 2],
    ['a\rb', 2],
    ['a\r\rb', 3],
    ['a\n\r\nb\rc', 4],
  ])('counts the lines of %j', (source, lineCount) => {
    expect(new LineTable(source).lineCount).toBe(lineCount);
  });

  it.each([
    // [source, offset, line, column]
    ['name.given', 0, 1, 1],
    ['name.given', 5, 1, 6],
    ['name.given', 10, 1, 11], // end of input
    ['a\nb', 1, 1, 2], // the line feed itself
    ['a\nb', 2, 2, 1],
    ['a\r\nb', 2, 1, 3], // the \n of a \r\n pair still belongs to line 1
    ['a\r\nb', 3, 2, 1],
    ['a\rb', 2, 2, 1],
    ['a\n\nb', 3, 3, 1],
    ['\tx', 1, 1, 2], // a tab is one column
    ['😀x', 2, 1, 3], // columns count UTF-16 code units
    ['ab\ncd', 9, 2, 7], // past the end
  ])('places offset %i of %j', (source, offset, line, column) => {
    expect(new LineTable(source).locate(offset)).toEqual({ line, column });
  });

  it('builds a span with the line and column of its start', () => {
    const table = new LineTable('name\n  .given');
    expect(table.span(7, 13)).toEqual({ start: 7, end: 13, line: 2, column: 3 });
    expect(table.span(7)).toEqual({ start: 7, end: 7, line: 2, column: 3 });
  });

  it('agrees with spanFromOffsets', () => {
    const source = fc.string({
      unit: fc.constantFrom('a', ' ', '\t', '\n', '\r', '😀'),
      maxLength: 30,
    });
    fc.assert(
      fc.property(
        source.chain((text) => fc.tuple(fc.constant(text), fc.nat({ max: text.length + 2 }))),
        ([text, offset]) => {
          expect(new LineTable(text).span(offset, offset + 1)).toEqual(
            spanFromOffsets(text, offset, offset + 1),
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});
