import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import type { SystemTypeName } from '../types/system-types.ts';
import type { Collection, Item } from './collection.ts';

/**
 * Converts an item to the expected type, or returns undefined when the item cannot be converted
 * implicitly. Used by {@link singleton}, so it does not depend on the value classes.
 *
 * A conversion accepts the type itself, the implicit conversions to it (`IMPLICIT_CONVERSIONS`),
 * and model data that converts to it (a FHIR `boolean` node where a Boolean is expected).
 *
 * @typeParam T - The representation of the expected type, such as `boolean` or `Decimal`. It
 *   is an {@link Item}, so it never includes `null` or `undefined`.
 */
export type ItemConversion<T extends Item> = (item: Item) => T | undefined;

/**
 * Singleton evaluation of a collection where an operator or function expects a single value
 * ([N1 §4.5](https://hl7.org/fhirpath/N1/#singleton-evaluation-of-collections), as clarified in
 * FHIRPath 3.0.0):
 *
 * 1. A single item that converts to the expected type gives the converted value.
 * 2. Otherwise, a single item where a Boolean is expected gives `true`.
 * 3. An empty collection gives `undefined` (empty).
 * 4. Anything else is an error. More than one item raises `eval/singleton-expected`. A single
 *    item that does not convert to an expected type other than Boolean raises
 *    `eval/type-mismatch`: the problem is its type, not the number of items.
 *
 * Boolean contexts (the criteria of `where()` and `iif()`, the operands of `and` and `or`) use
 * the Boolean overload, which gives `true`, `false` or `undefined`. When the expected type is only
 * known as a {@link SystemTypeName}, the result may also be the `true` of step 2.
 *
 * The error has no source span; the compiler attaches one at the operator or function call.
 *
 * @example
 * ```ts
 * singleton(operand, 'Boolean', toBoolean); // true | false | undefined
 * singleton(argument, 'Integer', toInteger); // number | undefined, or throws
 * ```
 *
 * @param collection - The evaluated operand or argument.
 * @param expectedType - The type the operator or function expects. Used for the Boolean rule and
 *   in error messages.
 * @param convert - Converts the single item, or returns undefined when it cannot.
 * @throws {@link FhirPathEvaluationError} in case 4: `eval/singleton-expected` for more than one
 *   item, `eval/type-mismatch` for a single item that does not convert.
 */
export function singleton(
  collection: Collection,
  expectedType: 'Boolean',
  convert: ItemConversion<boolean>,
): boolean | undefined;
export function singleton<T extends Item>(
  collection: Collection,
  expectedType: Exclude<SystemTypeName, 'Boolean'>,
  convert: ItemConversion<T>,
): T | undefined;
export function singleton<T extends Item>(
  collection: Collection,
  expectedType: SystemTypeName,
  convert: ItemConversion<T>,
): T | true | undefined;
export function singleton(
  collection: Collection,
  expectedType: SystemTypeName,
  convert: ItemConversion<Item>,
): Item | undefined {
  const count = collection.length;
  if (count === 0) {
    return undefined;
  }
  const item = collection[0];
  if (count === 1 && item !== undefined) {
    const value = convert(item);
    if (value !== undefined) {
      return value;
    }
    if (expectedType === 'Boolean') {
      return true;
    }
    throw new FhirPathEvaluationError(
      'eval/type-mismatch',
      `Expected ${expectedType}, but found an item that cannot be converted to ${expectedType}`,
    );
  }
  // "Expected a single item" reads better than "a single Any".
  const expected = expectedType === 'Any' ? 'item' : expectedType;
  throw new FhirPathEvaluationError(
    'eval/singleton-expected',
    `Expected a single ${expected} but found ${count} items`,
  );
}
