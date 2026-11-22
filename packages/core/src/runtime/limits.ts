/**
 * The bounds on the work of one evaluation
 * ([architecture: security and robustness](https://github.com/losol/callis/blob/main/docs/architecture.md#security-and-robustness)).
 *
 * `limits.maxCollectionSize` bounds every collection the evaluation builds. It is checked where a
 * collection grows beyond the size of what it is built from: a navigation step, `children()` and
 * `descendants()`, `repeat()`, the results of `select()`, `trace()` and `resolve()` for each item,
 * `|` and `union()`, and `combine()`. Every other operation gives at most as many items as its
 * input, so these checks bound them too. A check costs one comparison where an item or a list of
 * items is added, never a pass over the items.
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { appendAll, type Collection, EMPTY, type Item } from './collection.ts';

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
 * The items of the collections in order, as one collection: the results of a projection for each
 * input item, as `select()` gives them. The size is checked after each collection is added, so it
 * never grows by more than one of them beyond the limit.
 *
 * @throws {@link FhirPathEvaluationError} `eval/limit-exceeded` when the result would have more
 *   than `limits.maxCollectionSize` items.
 */
export function flattenWithin(collections: readonly Collection[], limits: Limits): Collection {
  const items: Item[] = [];
  for (const collection of collections) {
    appendAll(items, collection);
    checkCollectionSize(items.length, limits);
  }
  return items.length === 0 ? EMPTY : items;
}
