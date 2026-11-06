/**
 * Helpers for values that may be a promise ([ADR-0004](https://github.com/losol/callis/blob/main/docs/adr/0004-sync-core-async-path.md)).
 *
 * One closure tree serves `evaluate()` and `evaluateAsync()`. Every closure returns a value or a
 * promise of one, and stays synchronous until a promise actually appears, so sync evaluation pays
 * one cheap check per node. Promises are detected structurally with {@link isThenable}, never with
 * `instanceof Promise`, which misses promises from another realm and custom thenables. Host
 * results are adopted as native promises at the boundary ({@link adoptResult}), so the rest of the
 * engine only ever sees native promises.
 *
 * These helpers live in `runtime` rather than `compiler` because library functions (`where()`,
 * `select()`, host-backed functions) use them too, and `functions` may only import `runtime`.
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';

/** A value, or a native promise of it. */
export type MaybePromise<T> = T | Promise<T>;

/**
 * Whether a value is a thenable: an object or function with a callable `then` property. Works for
 * native promises, promises from another realm (an iframe, `node:vm`) and custom thenables.
 *
 * @see https://promisesaplus.com/#terminology
 */
export function isThenable<T>(value: T | PromiseLike<T>): value is PromiseLike<T>;
export function isThenable(value: unknown): value is PromiseLike<unknown>;
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    typeof (value as { readonly then?: unknown }).then === 'function'
  );
}

/**
 * Applies `next` to a value, or to the result of a promise. Synchronous when `value` is not a
 * thenable, so sync evaluation never creates a promise.
 *
 * It is not called `then`: a module that exports `then` is itself a thenable, and `import()` of it
 * would call that function instead of returning the module.
 *
 * @example
 * ```ts
 * andThen(target(ctx, focus, frame), (input) => navigate(input, name));
 * ```
 */
export function andThen<T, R>(
  value: T | PromiseLike<T>,
  next: (value: T) => MaybePromise<R>,
): MaybePromise<R> {
  return isThenable(value) ? Promise.resolve(value).then(next) : next(value);
}

/**
 * Calls `fn` for each item in order and collects the results. It stays synchronous until a call
 * returns a promise; from then on it waits for each result before starting the next call, so the
 * calls never overlap and run in input order.
 *
 * Lambda functions (`where()`, `select()`, …) use this to evaluate their criteria per item, and the
 * compiler uses it for function arguments.
 */
export function mapSequential<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => MaybePromise<R>,
): MaybePromise<R[]> {
  const results: R[] = [];
  let index = 0;
  for (const item of items) {
    const result = fn(item, index);
    if (isThenable(result)) {
      return finishSequential(result, results, items.slice(index + 1), index + 1, fn);
    }
    results.push(result);
    index++;
  }
  return results;
}

async function finishSequential<T, R>(
  pending: PromiseLike<R>,
  results: R[],
  rest: readonly T[],
  start: number,
  fn: (item: T, index: number) => MaybePromise<R>,
): Promise<R[]> {
  results.push(await pending);
  let index = start;
  for (const item of rest) {
    results.push(await fn(item, index));
    index++;
  }
  return results;
}

/**
 * The sync guard at a host boundary: the result of a host hook or of a function added with
 * `registry.extend()` ([T0021: sync and async](https://github.com/losol/callis/blob/main/docs/tasks/T0021-hooks-async.md#sync-and-async)).
 *
 * - A value that is not a thenable is returned as it is.
 * - In async mode a thenable is adopted with `Promise.resolve()`, so a cross-realm promise or a
 *   custom thenable becomes a native promise.
 * - In sync mode a thenable raises `eval/async-in-sync`. The thenable is still observed, so a
 *   rejection it settles with later is not reported as unhandled; the evaluation has already
 *   failed.
 *
 * @param isAsync - Whether this is an `evaluateAsync()` evaluation.
 * @throws {@link FhirPathEvaluationError} `eval/async-in-sync` for a thenable in sync mode.
 */
export function adoptResult<T>(value: T | PromiseLike<T>, isAsync: boolean): MaybePromise<T> {
  if (isAsync && isThenable(value)) {
    return Promise.resolve(value);
  }
  return requireSync(value);
}

/**
 * The sync guard on its own: the value itself, or `eval/async-in-sync` for a thenable. The
 * thenable is observed, so a rejection it settles with later is not reported as unhandled.
 *
 * @throws {@link FhirPathEvaluationError} `eval/async-in-sync` for a thenable.
 */
export function requireSync<T>(value: T | PromiseLike<T>): T {
  if (!isThenable(value)) {
    return value;
  }
  Promise.resolve(value).then(undefined, ignore);
  throw new FhirPathEvaluationError(
    'eval/async-in-sync',
    'Expected a synchronous result, but found a promise; use evaluateAsync() for asynchronous hooks and functions',
  );
}

function ignore(): void {}
