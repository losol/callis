import { describe, expect, it } from 'vitest';
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { adoptResult, andThen, isThenable, mapSequential, requireSync } from './maybe-promise.ts';

// https://github.com/losol/callis/blob/main/docs/adr/0004-sync-core-async-path.md
function thenable<T>(value: T): PromiseLike<T> {
  return {
    // biome-ignore lint/suspicious/noThenProperty: the test needs a custom thenable.
    then: (onFulfilled, onRejected) => Promise.resolve(value).then(onFulfilled, onRejected),
  };
}

describe('isThenable', () => {
  // biome-ignore lint/suspicious/noThenProperty: the test needs a function that is a thenable.
  const callable = Object.assign(() => undefined, { then: () => undefined });

  it.each<[string, unknown]>([
    ['a native promise', Promise.resolve(1)],
    ['a custom thenable', thenable(1)],
    ['a function with a then method', callable],
  ])('is true for %s', (_label, value) => {
    expect(isThenable(value)).toBe(true);
  });

  it.each<[string, unknown]>([
    ['an array', [1]],
    ['an object without then', { value: 1 }],
    // biome-ignore lint/suspicious/noThenProperty: the test needs a then that is not callable.
    ['an object whose then is not callable', { then: 1 }],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'then'],
  ])('is false for %s', (_label, value) => {
    expect(isThenable(value)).toBe(false);
  });
});

describe('andThen', () => {
  it('calls the continuation synchronously for a value', () => {
    let called = false;
    const result = andThen(1, (value) => {
      called = true;
      return value + 1;
    });
    expect(called).toBe(true);
    expect(result).toBe(2);
  });

  it('waits for a promise or a thenable', async () => {
    await expect(andThen(Promise.resolve(1), (value) => value + 1)).resolves.toBe(2);
    await expect(andThen(thenable(1), (value) => value + 1)).resolves.toBe(2);
  });
});

describe('mapSequential', () => {
  it('stays synchronous while every call is', () => {
    expect(mapSequential([1, 2, 3], (item, index) => item * 10 + index)).toEqual([10, 21, 32]);
  });

  it('switches to async when a call returns a promise, and keeps the order', async () => {
    const result = mapSequential([1, 2, 3], (item) =>
      item === 2 ? Promise.resolve(item * 10) : item * 10,
    );
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toEqual([10, 20, 30]);
  });

  it('starts each call after the previous one is done', async () => {
    const log: string[] = [];
    await mapSequential([1, 2], async (item) => {
      log.push(`start ${item}`);
      await Promise.resolve();
      log.push(`end ${item}`);
      return item;
    });
    expect(log).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
  });

  it('gives an empty array for no items', () => {
    expect(mapSequential([], () => 1)).toEqual([]);
  });
});

describe('the sync guard', () => {
  it('passes values through', () => {
    expect(requireSync(1)).toBe(1);
    expect(adoptResult(1, false)).toBe(1);
    expect(adoptResult(1, true)).toBe(1);
  });

  it('raises eval/async-in-sync for a thenable in sync mode', () => {
    for (const value of [Promise.resolve(1), thenable(1)]) {
      expect(() => requireSync(value)).toThrow(FhirPathEvaluationError);
      expect(() => adoptResult(value, false)).toThrow(
        expect.objectContaining({ code: 'eval/async-in-sync' }),
      );
    }
  });

  it('adopts a custom thenable as a native promise in async mode', async () => {
    const adopted = adoptResult(thenable(1), true);
    expect(adopted).toBeInstanceOf(Promise);
    await expect(adopted).resolves.toBe(1);
  });

  it('observes a rejected promise it refuses, so the rejection is not unhandled', async () => {
    expect(() => requireSync(Promise.reject(new Error('late')))).toThrow(FhirPathEvaluationError);
    // Vitest fails the run on an unhandled rejection; give it a chance to surface.
    await Promise.resolve();
    await Promise.resolve();
  });
});
