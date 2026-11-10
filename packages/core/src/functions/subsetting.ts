/**
 * The subsetting functions `first()`, `single()`, `last()`, `tail()`, `skip()`, `take()`,
 * `intersect()` and `exclude()` ([N1 §5.3](https://hl7.org/fhirpath/N1/#subsetting)). They select
 * input items; they never convert or copy them, so object identity and model provenance survive.
 * The combining functions `union()` and `combine()` are in `combining.ts`.
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { type Collection, EMPTY, fromOptional, type Item } from '../runtime/collection.ts';
import type { ComparisonContext } from '../runtime/comparison.ts';
import { itemEquals } from '../runtime/equality.ts';
import { asInteger } from '../runtime/item-conversion.ts';
import { singleton } from '../runtime/singleton.ts';
import { defineValueFunction, type FunctionDefinition, type ParamSpec } from './define.ts';

/**
 * `first()`: the first input item, unchanged, or empty when there is none.
 * @see https://hl7.org/fhirpath/N1/#first-collection
 */
export const firstFunction: FunctionDefinition = defineValueFunction(
  'first',
  0,
  (input) => fromOptional(input[0]),
  { returns: { singleton: true } },
);

/**
 * `single()`: the input unchanged when empty or singleton; errors on multiple items.
 * @see https://hl7.org/fhirpath/N1/#single-collection
 */
export const singleFunction: FunctionDefinition = defineValueFunction(
  'single',
  0,
  (input) => {
    if (input.length > 1) {
      throw new FhirPathEvaluationError(
        'eval/singleton-expected',
        `Expected a single item but found ${input.length} items`,
      );
    }
    return input;
  },
  { returns: { singleton: true } },
);

/**
 * `last()`: the last input item, unchanged, or empty when there is none.
 * @see https://hl7.org/fhirpath/N1/#last-collection
 */
export const lastFunction: FunctionDefinition = defineValueFunction(
  'last',
  0,
  (input) => fromOptional(input.at(-1)),
  { returns: { singleton: true } },
);

/**
 * `tail()`: all but the first input item, in input order; empty for input of at most one item.
 * @see https://hl7.org/fhirpath/N1/#tail-collection
 */
export const tailFunction: FunctionDefinition = defineValueFunction('tail', 0, (input) =>
  input.length > 1 ? input.slice(1) : EMPTY,
);

const NUM: readonly ParamSpec[] = Object.freeze([{ kind: 'value', name: 'num' }]);
const OTHER: readonly ParamSpec[] = Object.freeze([{ kind: 'value', name: 'other' }]);

/**
 * `skip(num)`: all but the first `num` input items, in input order. A `num` of zero or less gives
 * the input; a `num` of at least the number of items gives empty; an empty `num` gives empty
 * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#skip-and-take-with-an-empty-count)).
 * @see https://hl7.org/fhirpath/N1/#skipnum-integer-collection
 */
export const skipFunction: FunctionDefinition = defineValueFunction('skip', NUM, (input, args) => {
  const count = countOf(args);
  if (count === undefined) {
    return EMPTY;
  }
  if (count <= 0) {
    return input;
  }
  return count >= input.length ? EMPTY : input.slice(count);
});

/**
 * `take(num)`: the first `num` input items, in input order, or all of them when there are fewer. A
 * `num` of zero or less gives empty, and so does an empty `num`
 * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#skip-and-take-with-an-empty-count)).
 * @see https://hl7.org/fhirpath/N1/#takenum-integer-collection
 */
export const takeFunction: FunctionDefinition = defineValueFunction('take', NUM, (input, args) => {
  const count = countOf(args);
  if (count === undefined || count <= 0) {
    return EMPTY;
  }
  return count >= input.length ? input : input.slice(0, count);
});

/**
 * `intersect(other)`: the input items that equal (`=`) an item of `other`, without duplicates, in
 * input order. An item whose equality with every candidate is undetermined is not in the result
 * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#intersect-exclude-and-undetermined-equality)).
 * @see https://hl7.org/fhirpath/N1/#intersectother-collection-collection
 */
export const intersectFunction: FunctionDefinition = defineValueFunction(
  'intersect',
  OTHER,
  (input, args, call) => {
    const other = args[0] ?? EMPTY;
    if (input.length === 0 || other.length === 0) {
      return EMPTY;
    }
    const result: Item[] = [];
    for (const item of input) {
      if (!includesEqual(result, item, call.ctx) && includesEqual(other, item, call.ctx)) {
        result.push(item);
      }
    }
    return result.length === 0 ? EMPTY : result;
  },
);

/**
 * `exclude(other)`: the input items that equal (`=`) no item of `other`, in input order and
 * keeping duplicates. An item whose equality with every candidate is undetermined stays in the
 * result ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#intersect-exclude-and-undetermined-equality)).
 * @see https://hl7.org/fhirpath/N1/#excludeother-collection-collection
 */
export const excludeFunction: FunctionDefinition = defineValueFunction(
  'exclude',
  OTHER,
  (input, args, call) => {
    const other = args[0] ?? EMPTY;
    if (other.length === 0) {
      return input;
    }
    const result = input.filter((item) => !includesEqual(other, item, call.ctx));
    return result.length === input.length ? input : result;
  },
);

/** The implemented subsetting functions of the standard library. */
export const SUBSETTING_FUNCTIONS: readonly FunctionDefinition[] = Object.freeze([
  firstFunction,
  singleFunction,
  lastFunction,
  tailFunction,
  skipFunction,
  takeFunction,
  intersectFunction,
  excludeFunction,
]);

/**
 * The count argument as an Integer, or undefined when it is empty. Checked whatever the input is,
 * so an error does not depend on the data
 * ([singleton evaluation](https://hl7.org/fhirpath/N1/#singleton-evaluation-of-collections)).
 */
function countOf(args: readonly Collection[]): number | undefined {
  return singleton(args[0] ?? EMPTY, 'Integer', asInteger);
}

/**
 * Whether `items` has an item equal (`=`) to `item`. An undetermined comparison, such as dates of
 * different precision, is not equal, as for the `|` operator. `subsetOf()` and `supersetOf()`
 * use the same rule.
 */
export function includesEqual(items: Collection, item: Item, ctx: ComparisonContext): boolean {
  for (const candidate of items) {
    if (itemEquals(candidate, item, ctx) === true) {
      return true;
    }
  }
  return false;
}
