import { describe, expect, it } from 'vitest';

import { matchesExpected, runPlayground } from './run';

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
    expect(runPlayground('{}', 'missing')).toEqual({
      kind: 'result',
      value: [],
      count: 0,
      text: '[]',
    });
  });

  // https://hl7.org/fhirpath/N1/#decimal
  it('keeps exact computed decimal text in result JSON', () => {
    expect(runPlayground('{}', '0.1 + 0.2')).toEqual({
      kind: 'result',
      value: ['0.3'],
      count: 1,
      text: '[\n  "0.3"\n]',
    });
  });
});

describe('original expectation comparison', () => {
  it('compares values with types and array order, independently of object key order', () => {
    const actual = runPlayground('{"b":2,"a":1}', '$this');
    expect(matchesExpected(actual, { kind: 'result', value: [{ a: 1, b: 2 }] })).toBe(true);
    expect(matchesExpected(runPlayground('{}', '1 | 2'), { kind: 'result', value: [2, 1] })).toBe(
      false,
    );
    expect(matchesExpected(runPlayground('{}', '1'), { kind: 'result', value: ['1'] })).toBe(false);
    expect(matchesExpected(runPlayground('{}', '{}'), { kind: 'result', value: [false] })).toBe(
      false,
    );
  });

  it('compares actual public errors by phase and stable code, never display text', () => {
    const actual = runPlayground('{}', '%missing');
    expect(
      matchesExpected(actual, {
        kind: 'error',
        phase: 'expression',
        code: 'eval/undefined-variable',
      }),
    ).toBe(true);
    expect(
      matchesExpected(actual, {
        kind: 'error',
        phase: 'expression',
        code: 'semantic/unknown-function',
      }),
    ).toBe(false);
    expect(matchesExpected(actual, { kind: 'error', phase: 'json' })).toBe(false);
    expect(matchesExpected(runPlayground('{', 'unknown()'), { kind: 'error', phase: 'json' })).toBe(
      true,
    );
    expect(matchesExpected(runPlayground('{}', 'unknown()'), { kind: 'result', value: [] })).toBe(
      false,
    );
  });
});
