import { type Collection, fromBoolean } from '../runtime/collection.ts';
import { isThenable, type MaybePromise } from '../runtime/maybe-promise.ts';
import { matchesCriteria } from './criteria.ts';
import {
  defineFunction,
  defineValueFunction,
  type FunctionDefinition,
  type LambdaArg,
  lambdaArg,
} from './define.ts';

/**
 * `exists([criteria])`: whether input has an item, or an item matching the bound criterion.
 * A match stops iteration; empty input does not evaluate criteria and returns false.
 * @see https://hl7.org/fhirpath/N1/#existscriteria-expression-boolean
 */
export const existsFunction: FunctionDefinition = defineFunction({
  name: 'exists',
  params: [{ kind: 'lambda', name: 'criteria', optional: true }],
  returns: { type: 'Boolean', singleton: true },
  impl: (_call, input, args) => {
    const criteria = lambdaArg(args, 0);
    return criteria === undefined ? fromBoolean(input.length > 0) : existsMatching(input, criteria);
  },
});

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

/** The implemented existence functions of the standard library. */
export const EXISTENCE_FUNCTIONS: readonly FunctionDefinition[] = Object.freeze([
  existsFunction,
  countFunction,
]);

function existsMatching(input: Collection, criteria: LambdaArg): MaybePromise<Collection> {
  let index = 0;
  for (const item of input) {
    const matches = matchesCriteria(criteria, item, index);
    if (isThenable(matches)) return finishExists(matches, input, index + 1, criteria);
    if (matches) return fromBoolean(true);
    index++;
  }
  return fromBoolean(false);
}

/** Continue only after the first asynchronous criterion; never start a later item early. */
async function finishExists(
  pending: PromiseLike<boolean>,
  input: Collection,
  start: number,
  criteria: LambdaArg,
): Promise<Collection> {
  if (await pending) return fromBoolean(true);
  for (let index = start; index < input.length; index++) {
    const item = input[index];
    if (item !== undefined && (await matchesCriteria(criteria, item, index)))
      return fromBoolean(true);
  }
  return fromBoolean(false);
}
