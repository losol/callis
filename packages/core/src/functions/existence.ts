/**
 * The existence functions `empty()`, `exists()`, `all()`, `allTrue()`, `anyTrue()`,
 * `allFalse()`, `anyFalse()`, `subsetOf()`, `supersetOf()`, `count()`, `distinct()` and
 * `isDistinct()` ([N1 §5.1](https://hl7.org/fhirpath/N1/#existence)). They compare items with
 * `=`, through the same kernel as `|`, `in` and `intersect()`.
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { type Collection, EMPTY, fromBoolean } from '../runtime/collection.ts';
import type { ComparisonContext } from '../runtime/comparison.ts';
import { itemEquals } from '../runtime/equality.ts';
import { andThen, isThenable, type MaybePromise } from '../runtime/maybe-promise.ts';
import { toSystemValue } from '../runtime/node-value.ts';
import { matchesCriteria } from './criteria.ts';
import {
  defineFunction,
  defineValueFunction,
  type FunctionDefinition,
  type LambdaArg,
  lambdaArg,
  type ParamSpec,
  type TypeHint,
} from './define.ts';
import { includesEqual } from './subsetting.ts';

const BOOLEAN: { readonly returns: TypeHint } = Object.freeze({
  returns: Object.freeze({ type: 'Boolean', singleton: true }),
});
const OTHER: readonly ParamSpec[] = Object.freeze([{ kind: 'value', name: 'other' }]);
/** A criterion: evaluated per item, and a Boolean by singleton evaluation. */
const CRITERIA: ParamSpec = {
  kind: 'lambda',
  name: 'criteria',
  expects: { type: 'Boolean', singleton: true },
};

/**
 * `empty()`: true when the input has no items, false otherwise.
 * @see https://hl7.org/fhirpath/N1/#empty-boolean
 */
export const emptyFunction: FunctionDefinition = defineValueFunction(
  'empty',
  0,
  (input) => fromBoolean(input.length === 0),
  BOOLEAN,
);

/**
 * `exists([criteria])`: whether input has an item, or an item matching the bound criterion.
 * A match stops iteration; empty input does not evaluate criteria and returns false.
 * @see https://hl7.org/fhirpath/N1/#existscriteria-expression-boolean
 */
export const existsFunction: FunctionDefinition = defineFunction({
  name: 'exists',
  params: [{ ...CRITERIA, optional: true }],
  ...BOOLEAN,
  impl: (_call, input, args) => {
    const criteria = lambdaArg(args, 0);
    return criteria === undefined
      ? fromBoolean(input.length > 0)
      : andThen(findItem(input, criteria, true), fromBoolean);
  },
});

/**
 * `all(criteria)`: whether the bound criterion matches every input item, by the same Boolean rule
 * as `where()`. The first item that does not match stops iteration, as a match stops `exists()`
 * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#all-stops-at-the-first-item-that-does-not-match));
 * empty input does not evaluate the criterion and returns true.
 * @see https://hl7.org/fhirpath/N1/#allcriteria-expression-boolean
 */
export const allFunction: FunctionDefinition = defineFunction({
  name: 'all',
  params: [CRITERIA],
  ...BOOLEAN,
  impl: (_call, input, args) => {
    // The registry checked the arity, so the criterion is there.
    const criteria = lambdaArg(args, 0);
    if (criteria === undefined) return EMPTY;
    return andThen(findItem(input, criteria, false), (found) => fromBoolean(!found));
  },
});

/**
 * `allTrue()`: true when no input item is false, so also for empty input. The items must be
 * Booleans ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#alltrue-and-the-like-take-only-booleans)).
 * @see https://hl7.org/fhirpath/N1/#alltrue-boolean
 */
export const allTrueFunction: FunctionDefinition = booleanFunction(
  'allTrue',
  (values) => !values.includes(false),
);

/**
 * `anyTrue()`: true when an input item is true; false for empty input. The items must be
 * Booleans ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#alltrue-and-the-like-take-only-booleans)).
 * @see https://hl7.org/fhirpath/N1/#anytrue-boolean
 */
export const anyTrueFunction: FunctionDefinition = booleanFunction('anyTrue', (values) =>
  values.includes(true),
);

/**
 * `allFalse()`: true when no input item is true, so also for empty input. The items must be
 * Booleans ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#alltrue-and-the-like-take-only-booleans)).
 * @see https://hl7.org/fhirpath/N1/#allfalse-boolean
 */
export const allFalseFunction: FunctionDefinition = booleanFunction(
  'allFalse',
  (values) => !values.includes(true),
);

/**
 * `anyFalse()`: true when an input item is false; false for empty input. The items must be
 * Booleans ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#alltrue-and-the-like-take-only-booleans)).
 * @see https://hl7.org/fhirpath/N1/#anyfalse-boolean
 */
export const anyFalseFunction: FunctionDefinition = booleanFunction('anyFalse', (values) =>
  values.includes(false),
);

/**
 * `subsetOf(other)`: whether every input item is in `other`. An item is in `other` when `=` is
 * true for one of its items; false and undetermined both mean it is not, as 3.0.0 clarifies. True
 * for empty input; otherwise false for an empty `other`.
 * @see https://hl7.org/fhirpath/N1/#subsetofother-collection-boolean
 * @see https://hl7.org/fhirpath/STU3/en/index.html#subsetofother--collection--boolean
 */
export const subsetOfFunction: FunctionDefinition = defineValueFunction(
  'subsetOf',
  OTHER,
  (input, args, call) => fromBoolean(isSubset(input, args[0] ?? EMPTY, call.ctx)),
  BOOLEAN,
);

/**
 * `supersetOf(other)`: whether every item of `other` is in the input, by the membership rule of
 * `subsetOf()`. True for an empty `other`; otherwise false for empty input.
 * @see https://hl7.org/fhirpath/N1/#supersetofother-collection-boolean
 * @see https://hl7.org/fhirpath/STU3/en/index.html#supersetofother--collection--boolean
 */
export const supersetOfFunction: FunctionDefinition = defineValueFunction(
  'supersetOf',
  OTHER,
  (input, args, call) => fromBoolean(isSubset(args[0] ?? EMPTY, input, call.ctx)),
  BOOLEAN,
);

/**
 * `count()`: the number of items, including duplicates; zero for empty input.
 * @see https://hl7.org/fhirpath/N1/#count-integer
 */
export const countFunction: FunctionDefinition = defineValueFunction(
  'count',
  0,
  (input) => [input.length],
  { returns: { type: 'Integer', singleton: true } },
);

/**
 * `distinct()`: the input items without repeats. Two items are equal only when `=` is true; false
 * and empty both mean that they are distinct, as 3.0.0 says, so `@2020` and `@2020-01-01` both
 * remain. Of equal items the last remains, in input order; the input items are returned
 * themselves
 * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#distinct-and-isdistinct)).
 * @see https://hl7.org/fhirpath/N1/#distinct-collection
 * @see https://hl7.org/fhirpath/STU3/en/index.html#distinct--collection
 */
export const distinctFunction: FunctionDefinition = defineValueFunction(
  'distinct',
  0,
  (input, _args, call) => {
    const repeated = laterRepeats(input, call.ctx);
    return repeated.includes(true) ? input.filter((_item, index) => !repeated[index]) : input;
  },
  { returns: { fromInput: true } },
);

/**
 * `isDistinct()`: whether no two input items are equal, by the rule of `distinct()`: only a true
 * `=` makes two items equal. True for empty input, never empty
 * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#distinct-and-isdistinct)).
 * @see https://hl7.org/fhirpath/N1/#isdistinct-boolean
 * @see https://hl7.org/fhirpath/STU3/en/index.html#isdistinct--boolean
 */
export const isDistinctFunction: FunctionDefinition = defineValueFunction(
  'isDistinct',
  0,
  (input, _args, call) => fromBoolean(!laterRepeats(input, call.ctx).includes(true)),
  BOOLEAN,
);

/** The existence functions of the standard library. */
export const EXISTENCE_FUNCTIONS: readonly FunctionDefinition[] = Object.freeze([
  emptyFunction,
  existsFunction,
  allFunction,
  allTrueFunction,
  anyTrueFunction,
  allFalseFunction,
  anyFalseFunction,
  subsetOfFunction,
  supersetOfFunction,
  countFunction,
  distinctFunction,
  isDistinctFunction,
]);

/**
 * Whether the criterion result of an input item is `wanted`: a match for `exists()`, no match for
 * `all()`. The first such item stops iteration, so later criteria are not evaluated.
 */
function findItem(input: Collection, criteria: LambdaArg, wanted: boolean): MaybePromise<boolean> {
  let index = 0;
  for (const item of input) {
    const matches = matchesCriteria(criteria, item, index);
    if (isThenable(matches)) return finishFind(matches, input, index + 1, criteria, wanted);
    if (matches === wanted) return true;
    index++;
  }
  return false;
}

/** Continue only after the first asynchronous criterion; never start a later item early. */
async function finishFind(
  pending: PromiseLike<boolean>,
  input: Collection,
  start: number,
  criteria: LambdaArg,
  wanted: boolean,
): Promise<boolean> {
  if ((await pending) === wanted) return true;
  for (let index = start; index < input.length; index++) {
    const item = input[index];
    if (item !== undefined && (await matchesCriteria(criteria, item, index)) === wanted) {
      return true;
    }
  }
  return false;
}

/**
 * A function of a collection of Booleans, such as `allTrue()`. Every input item is checked, so
 * the error for an item that is not a Boolean does not depend on the other items.
 */
function booleanFunction(
  name: string,
  test: (values: readonly boolean[]) => boolean,
): FunctionDefinition {
  return defineValueFunction(name, 0, (input) => fromBoolean(test(booleansOf(input, name))), {
    input: { type: 'Boolean' },
    ...BOOLEAN,
  });
}

/**
 * The Boolean values of the input items. A FHIR `boolean` that holds no value, only extensions,
 * is left out, as an empty Boolean is in singleton evaluation.
 *
 * @throws {@link FhirPathEvaluationError} `eval/type-mismatch` for an item that is not a Boolean.
 */
function booleansOf(input: Collection, name: string): boolean[] {
  const values: boolean[] = [];
  for (const item of input) {
    const value = toSystemValue(item);
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      throw new FhirPathEvaluationError(
        'eval/type-mismatch',
        `Expected only Boolean input items for ${name}(), but found an item that is not a Boolean`,
      );
    }
    values.push(value);
  }
  return values;
}

/** Whether every item of `items` is in `other`, by `=` ({@link includesEqual}). */
function isSubset(items: Collection, other: Collection, ctx: ComparisonContext): boolean {
  return items.every((item) => includesEqual(other, item, ctx));
}

/**
 * For each input item, whether a later item equals it: `=` is true for the pair. An undetermined
 * comparison counts as not equal, as 3.0.0 says for `distinct()` and as it does for `|`: dates of
 * different precision, quantities whose units cannot be related, an element that holds only
 * extensions, or complex values whose children cannot be compared. An item already known to
 * repeat is not compared again.
 */
function laterRepeats(input: Collection, ctx: ComparisonContext): boolean[] {
  const repeated: boolean[] = [];
  for (const item of input) {
    let index = 0;
    for (const earlier of input) {
      if (index === repeated.length) break;
      if (repeated[index] !== true && itemEquals(earlier, item, ctx) === true) {
        repeated[index] = true;
      }
      index++;
    }
    repeated.push(false);
  }
  return repeated;
}
