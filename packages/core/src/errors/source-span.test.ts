import { describe, expect, it } from 'vitest';
import { spanFromOffsets } from './source-span.ts';

describe('spanFromOffsets', () => {
  it.each([
    // [source, start, line, column]
    ['name.given', 0, 1, 1],
    ['name.given', 5, 1, 6],
    ['name.given', 10, 1, 11], // end of input
    ['a\nb', 2, 2, 1],
    ['a\r\nb', 3, 2, 1],
    ['a\r\nb', 2, 1, 3], // the \n of a \r\n pair still belongs to line 1
    ['a\rb', 2, 2, 1],
    ['a\n\nb', 3, 3, 1],
  ])('places offset %#', (source, start, line, column) => {
    expect(spanFromOffsets(source, start)).toEqual({ start, end: start, line, column });
  });

  it('keeps the end offset', () => {
    expect(spanFromOffsets('Patient.name', 8, 12)).toEqual({
      start: 8,
      end: 12,
      line: 1,
      column: 9,
    });
  });
});
