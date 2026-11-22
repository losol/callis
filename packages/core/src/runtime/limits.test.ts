import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, evaluate } from '../api/compile.ts';
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { EMPTY } from './collection.ts';
import { checkCollectionSize, flattenWithin, type Limits } from './limits.ts';

const limits: Limits = { maxRepeatItems: 5_000, maxCollectionSize: 3 };

// docs/architecture.md#security-and-robustness: bounded work.
describe('the collection size limit', () => {
  it('accepts a collection up to the limit and raises eval/limit-exceeded beyond it', () => {
    expect(() => checkCollectionSize(3, limits)).not.toThrow();
    expect(() => checkCollectionSize(4, limits)).toThrow(FhirPathEvaluationError);
    expect(() => checkCollectionSize(4, limits)).toThrow(
      expect.objectContaining({ code: 'eval/limit-exceeded' }),
    );
  });

  it('bounds nothing without limits, as for the equality kernels', () => {
    expect(() => checkCollectionSize(Number.MAX_SAFE_INTEGER, undefined)).not.toThrow();
  });

  it('flattens collections in order, within the limit', () => {
    expect(flattenWithin([[1], [], [2, 3]], limits)).toEqual([1, 2, 3]);
    expect(flattenWithin([[], []], limits)).toBe(EMPTY);
    expect(() => flattenWithin([[1, 2], [3, 4], [5]], limits)).toThrow(
      expect.objectContaining({ code: 'eval/limit-exceeded' }),
    );
  });

  // docs/tasks/T0038b-public-async-hooks-limits.md#the-maxcollectionsize-default
  it('has documented finite defaults', () => {
    expect(DEFAULT_LIMITS).toEqual({ maxRepeatItems: 5_000, maxCollectionSize: 1_000_000 });
    expect(Object.isFrozen(DEFAULT_LIMITS)).toBe(true);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '10', null])(
    'rejects maxCollectionSize %s, even when nothing grows',
    (maxCollectionSize) => {
      expect(() => evaluate(null, '1', { limits: { maxCollectionSize } as never })).toThrow(
        expect.objectContaining({ code: 'eval/invalid-argument' }),
      );
    },
  );

  it('fills in the default of a limit left out', () => {
    expect(evaluate(null, '1 | 2 | 3', { limits: { maxRepeatItems: 1 } })).toEqual([1, 2, 3]);
    expect(() => evaluate(null, '1 | 2 | 3', { limits: { maxCollectionSize: 2 } })).toThrow(
      expect.objectContaining({ code: 'eval/limit-exceeded' }),
    );
  });
});
