import { describe, expect, it } from 'vitest';

import { runPlayground } from './run';

describe('playground run', () => {
  it('reports invalid JSON before evaluating the expression', () => {
    expect(runPlayground('{', 'unknown()')).toMatchObject({ kind: 'error', area: 'Invalid JSON' });
  });

  it('keeps unsupported-function errors distinct from JSON errors', () => {
    expect(runPlayground('{}', 'unknown()')).toMatchObject({
      kind: 'error',
      area: 'Expression error',
      text: expect.stringContaining('semantic/unknown-function'),
    });
  });

  it('displays the empty collection as an array', () => {
    expect(runPlayground('{}', 'missing')).toEqual({ kind: 'result', count: 0, text: '[]' });
  });

  // https://hl7.org/fhirpath/N1/#decimal
  it('keeps exact computed decimal text in result JSON', () => {
    expect(runPlayground('{}', '0.1 + 0.2')).toEqual({
      kind: 'result',
      count: 1,
      text: '[\n  "0.3"\n]',
    });
  });
});
