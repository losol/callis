import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, evaluate } from '../api/compile.ts';
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { EMPTY, flatten } from './collection.ts';
import { checkCollectionSize, type Limits, sizeCounter } from './limits.ts';

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

  it('counts the results for each item as they arrive, and raises once they pass the limit', () => {
    const count = sizeCounter(limits);
    expect(() => count([1, 2])).not.toThrow();
    expect(() => count([])).not.toThrow();
    expect(() => count([3])).not.toThrow();
    expect(() => count([4])).toThrow(expect.objectContaining({ code: 'eval/limit-exceeded' }));
    // Each counter starts at zero.
    expect(() => sizeCounter(limits)([1, 2, 3])).not.toThrow();
  });

  it('flattens collections in order', () => {
    expect(flatten([[1], [], [2, 3]])).toEqual([1, 2, 3]);
    expect(flatten([[], []])).toBe(EMPTY);
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
