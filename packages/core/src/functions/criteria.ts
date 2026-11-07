import type { Item } from '../runtime/collection.ts';
import { asBoolean } from '../runtime/item-conversion.ts';
import { andThen, type MaybePromise } from '../runtime/maybe-promise.ts';
import { singleton } from '../runtime/singleton.ts';
import type { LambdaArg } from './define.ts';

/**
 * Evaluates a bound criterion for one input item, using the canonical Boolean singleton rule.
 * False and empty do not match; a single non-Boolean uses singleton's existing true fallback.
 * The caller owns iteration, so `where` can visit every item and `exists` can stop at a match.
 * @see https://hl7.org/fhirpath/N1/#singleton-evaluation-of-collections
 * @see https://hl7.org/fhirpath/N1/#wherecriteria-expression-collection
 */
export function matchesCriteria(
  criteria: LambdaArg,
  item: Item,
  index: number,
): MaybePromise<boolean> {
  return andThen(
    criteria.forItem(item, index),
    (result) => singleton(result, 'Boolean', asBoolean) === true,
  );
}
