/**
 * The bounds on the work of one evaluation
 * ([architecture: security and robustness](https://github.com/losol/callis/blob/main/docs/architecture.md#security-and-robustness)).
 *
 * `limits.maxCollectionSize` bounds every collection the evaluation builds. It is checked where a
 * collection grows beyond the size of what it is built from: a navigation step, `children()` and
 * `descendants()`, `repeat()`, the results of `select()`, `trace()` and `resolve()` for each item,
 * `|` and `union()`, `combine()`, and `toChars()`, which makes one item for each character of a
 * String, before it builds them. Every other operation gives at most as many items as its
 * input, so these checks bound them too. A check costs one comparison where an item or a list of
 * items is added, never a pass over the items. Results for each item are counted as they arrive
 * ({@link sizeCounter}), so the evaluation stops before it makes the rest of them.
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import type { Collection } from './collection.ts';

/**
 * The bounds on the work of one evaluation, from the `limits` evaluation option and its defaults.
 * Exceeding one raises `eval/limit-exceeded`.
 */
export interface Limits {
  /** The most items one `repeat()` call may produce. */
  readonly maxRepeatItems: number;
  /** The most items any collection that the evaluation builds may have. */
  readonly maxCollectionSize: number;
}

/**
 * A context that carries the limits of an evaluation. `EvalContext` always does; the contexts of
 * the equality kernels, which navigate the children of one node at a time, and of unit tests may
 * leave them out, and their navigation is then not bounded.
 */
export interface LimitsContext {
  readonly limits?: Limits;
}

/**
 * Checks the size of a collection being built.
 *
 * @throws {@link FhirPathEvaluationError} `eval/limit-exceeded` when `size` is more than
 *   `limits.maxCollectionSize`.
 */
export function checkCollectionSize(size: number, limits: Limits | undefined): void {
  if (limits !== undefined && size > limits.maxCollectionSize) {
    throw new FhirPathEvaluationError(
      'eval/limit-exceeded',
      `Expected a collection of at most ${limits.maxCollectionSize} items (limits.maxCollectionSize)`,
    );
  }
}

/**
 * A counter for the results that `select()`, `trace()` and `resolve()` make for each input item,
 * which are flattened into one collection. Pass it as the `accept` callback of `mapSequential()`
 * or `mapConcurrent()`: it adds each result's size as the result arrives, and raises before the
 * next item is projected or its hook called, so the evaluation never makes more than one result
 * beyond the limit (or, in `evaluateAsync()`, the hook calls already running).
 *
 * @throws {@link FhirPathEvaluationError} `eval/limit-exceeded`, from the counter, when the results
 *   together have more than `limits.maxCollectionSize` items.
 */
export function sizeCounter(limits: Limits): (result: Collection) => void {
  let size = 0;
  return (result) => {
    size += result.length;
    checkCollectionSize(size, limits);
  };
}
