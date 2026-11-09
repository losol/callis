/**
 * The filtering and projection functions `where()`, `select()`, `repeat()` and `ofType()`
 * ([N1 §5.2](https://hl7.org/fhirpath/N1/#filtering-and-projection)).
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { appendAll, type Collection, EMPTY, type Item } from '../runtime/collection.ts';
import type { EvalContext } from '../runtime/context.ts';
import { andThen, isThenable, type MaybePromise, mapSequential } from '../runtime/maybe-promise.ts';
import { assertResolved, matchesTypeTarget } from '../runtime/type-target.ts';
import { matchesCriteria } from './criteria.ts';
import {
  defineFunction,
  type FunctionDefinition,
  type LambdaArg,
  lambdaArg,
  typeArg,
} from './define.ts';
import { includesEqual } from './subsetting.ts';

/**
 * `where(criteria)`: retains matching input items in order, with their original provenance.
 * Empty input does not evaluate the criterion. Each item has its own bound `$this` and `$index`.
 * @see https://hl7.org/fhirpath/N1/#wherecriteria-expression-collection
 */
export const whereFunction: FunctionDefinition = defineFunction({
  name: 'where',
  params: [{ kind: 'lambda', name: 'criteria' }],
  impl: (_call, input, args) => {
    const criteria = lambdaArg(args, 0);
    if (criteria === undefined) return EMPTY;
    return andThen(
      mapSequential(input, (item, index) => matchesCriteria(criteria, item, index)),
      (matches) => input.filter((_item, index) => matches[index] === true),
    );
  },
});

/**
 * `select(projection)`: the results of the projection for every input item, flattened, in input
 * order. Each item is the focus and `$this`, and its position is `$index`. Empty input does not
 * evaluate the projection.
 * @see https://hl7.org/fhirpath/N1/#selectprojection-expression-collection
 * @see https://hl7.org/fhirpath/STU3/en/index.html#selectprojection-this-index--any--collection
 */
export const selectFunction: FunctionDefinition = defineFunction({
  name: 'select',
  params: [{ kind: 'lambda', name: 'projection' }],
  impl: (_call, input, args) => {
    const projection = lambdaArg(args, 0);
    if (projection === undefined) return EMPTY;
    return andThen(
      mapSequential(input, (item, index) => projection.forItem(item, index)),
      flatten,
    );
  },
});

/**
 * `repeat(projection)`: the projection of the input items, then of each new item it gives, until
 * no new item comes. An item is new when no item of the result equals it (`=` is true); the result
 * lists the new items in the order they are found, and the input items only if the projection
 * gives them. The projection is evaluated on one item at a time, as its focus and `$this`; 3.0.0
 * does not set `$index` there, so it stays that of the call.
 *
 * Deduplication ends the walk on data, but a projection that makes new values, such as
 * `'x'.repeat($this & 'x')`, never runs out. More than `limits.maxRepeatItems` items raise
 * `eval/limit-exceeded` ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#repeat)).
 * @see https://hl7.org/fhirpath/N1/#repeatprojection-expression-collection
 * @see https://hl7.org/fhirpath/STU3/en/index.html#repeatprojection-this--collection--collection
 */
export const repeatFunction: FunctionDefinition = defineFunction({
  name: 'repeat',
  params: [{ kind: 'lambda', name: 'projection' }],
  impl: (call, input, args) => {
    const projection = lambdaArg(args, 0);
    if (projection === undefined) return EMPTY;
    return repeatProjection(call.ctx, projection, input);
  },
});

/**
 * `ofType(type)`: the input items of the type or a subtype, in input order. It shares the target
 * resolution of `is` and `as`, so a type that does not resolve raises `eval/unknown-type`, also on
 * empty input; without a model, a resource name keeps the objects with that own `resourceType`.
 * A FHIR primitive also matches the System type it maps to
 * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#fhir-primitives-in-is-as-and-oftype)).
 * @see https://hl7.org/fhirpath/N1/#oftypetype-type-specifier-collection
 */
export const ofTypeFunction: FunctionDefinition = defineFunction({
  name: 'ofType',
  params: [{ kind: 'type', name: 'type' }],
  impl: (call, input, args) => {
    const target = typeArg(args, 0);
    assertResolved(target);
    const result = input.filter((item) => matchesTypeTarget(item, target, call.ctx, 'ofType'));
    return result.length === input.length ? input : result;
  },
});

/** The filtering and projection functions of the standard library. */
export const FILTERING_FUNCTIONS: readonly FunctionDefinition[] = Object.freeze([
  whereFunction,
  selectFunction,
  repeatFunction,
  ofTypeFunction,
]);

function flatten(results: readonly Collection[]): Collection {
  const items: Item[] = [];
  for (const result of results) {
    appendAll(items, result);
  }
  return items.length === 0 ? EMPTY : items;
}

/**
 * `repeat()` as 3.0.0 describes it: a queue that starts with the input items; each item taken
 * from it is projected, and every new item of the projection joins the result and the end of the
 * queue. The queue holds at most the input and the result, so the limit on the result bounds it
 * too. Stays synchronous until a projection returns a promise.
 */
function repeatProjection(
  ctx: EvalContext,
  projection: LambdaArg,
  input: Collection,
): MaybePromise<Collection> {
  const queue: Item[] = [...input];
  const result: Item[] = [];
  let next = 0;
  // The loop also visits the items that addNewItems() appends to the queue.
  for (const item of queue) {
    next++;
    const projected = projection.forInput([item]);
    if (isThenable(projected)) {
      return finishRepeat(ctx, projection, queue, result, projected, next);
    }
    addNewItems(ctx, queue, result, projected);
  }
  return result.length === 0 ? EMPTY : result;
}

/** Continue only after the pending projection; never start a later item early. */
async function finishRepeat(
  ctx: EvalContext,
  projection: LambdaArg,
  queue: Item[],
  result: Item[],
  pending: PromiseLike<Collection>,
  start: number,
): Promise<Collection> {
  addNewItems(ctx, queue, result, await pending);
  for (let next = start; next < queue.length; next++) {
    const item = queue[next];
    if (item !== undefined) {
      addNewItems(ctx, queue, result, await projection.forInput([item]));
    }
  }
  return result.length === 0 ? EMPTY : result;
}

/**
 * Adds the items of a projection that are not in the result yet to the result and the queue.
 *
 * @throws {@link FhirPathEvaluationError} `eval/limit-exceeded` when the result would have more
 *   than `limits.maxRepeatItems` items.
 */
function addNewItems(ctx: EvalContext, queue: Item[], result: Item[], projected: Collection): void {
  const limit = ctx.limits.maxRepeatItems;
  for (const item of projected) {
    if (includesEqual(result, item, ctx)) continue;
    if (result.length >= limit) {
      throw new FhirPathEvaluationError(
        'eval/limit-exceeded',
        `Expected repeat() to produce at most ${limit} items (limits.maxRepeatItems)`,
      );
    }
    result.push(item);
    queue.push(item);
  }
}
