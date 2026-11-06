/**
 * Conversions of one item to the type an operator or function expects, for `singleton()`
 * ([N1 §4.5](https://hl7.org/fhirpath/N1/#singleton-evaluation-of-collections)). Each accepts the
 * type itself and input nodes whose value has that type. Later tasks add the other types.
 */
import type { Item } from './collection.ts';
import { toSystemValue } from './node-value.ts';

/** The item as a Boolean, or undefined when it is not one. */
export function asBoolean(item: Item): boolean | undefined {
  const value = toSystemValue(item);
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * The item as an Integer, or undefined when it is not one. Nothing converts implicitly to
 * Integer ([N1 §5.5](https://hl7.org/fhirpath/N1/#conversion)), so a Decimal is not accepted.
 */
export function asInteger(item: Item): number | undefined {
  const value = toSystemValue(item);
  return typeof value === 'number' ? value : undefined;
}
