/**
 * Collections: the result of every FHIRPath expression.
 *
 * @see https://hl7.org/fhirpath/N1/#navigation-model
 */

/**
 * One item of a collection. Never `null` or `undefined`; FHIRPath has no null, and a missing value
 * is an empty collection ([N1 §4.4](https://hl7.org/fhirpath/N1/#null-and-empty)).
 *
 * | FHIRPath type | Representation |
 * | --- | --- |
 * | `Boolean`, `String` | `boolean`, `string` |
 * | `Integer` | `number` (a 32-bit integer) |
 * | `Long` (phase 2) | `bigint` |
 * | `Decimal`, `Date`, `DateTime`, `Time`, `Quantity` | value classes (`Decimal`, `DateValue`, …) |
 * | Model data | `ModelNode` |
 *
 * Object items are open over `object`, so the value classes, which are built in separate modules,
 * fit without this module depending on them. An item is never an array or another collection
 * (nested collections are a classic FHIRPath bug): object items must not be iterable, so
 * `const item: Item = [1, 2]` does not compile. A side effect: an object literal written where an
 * `Item` is expected is checked for excess properties, so wrap JSON data in a `ModelNode`.
 */
export type Item =
  | boolean
  | string
  | number
  | bigint
  | (object & { readonly [Symbol.iterator]?: never });

/**
 * An ordered, read-only list of items. Empty is `[]`.
 *
 * Collections are never mutated once returned; the `readonly` type enforces it. Code that builds
 * a collection uses a local `Item[]` and returns it when done.
 */
export type Collection = readonly Item[];

/** The empty collection, shared and frozen so returning it never allocates. */
export const EMPTY: Collection = Object.freeze([]);

const TRUE: Collection = Object.freeze([true]);
const FALSE: Collection = Object.freeze([false]);

/**
 * A collection with the item, or {@link EMPTY} when there is no item.
 *
 * @example
 * ```ts
 * fromOptional(element.code); // [code] or []
 * ```
 */
export function fromOptional(item: Item | undefined): Collection {
  return item === undefined ? EMPTY : [item];
}

/**
 * The collection for a three-valued Boolean result: `[true]`, `[false]`, or empty for
 * `undefined`. The returned collections are shared and frozen.
 */
export function fromBoolean(value: boolean | undefined): Collection {
  if (value === undefined) {
    return EMPTY;
  }
  return value ? TRUE : FALSE;
}

/**
 * The items of `left` followed by the items of `right`, keeping duplicates, as `combine()` does
 * ([N1 §5.4.2](https://hl7.org/fhirpath/N1/#combineother-collection-collection)). Returns one of
 * the inputs unchanged when the other is empty, so it does not copy.
 */
export function concat(left: Collection, right: Collection): Collection {
  if (right.length === 0) {
    return left;
  }
  if (left.length === 0) {
    return right;
  }
  const items: Item[] = [];
  appendAll(items, left);
  appendAll(items, right);
  return items;
}

/**
 * Appends every item of `source` to `target`, a collection being built. Unlike
 * `target.push(...source)` it works for collections of any size.
 *
 * `source` may be `target` itself: its length is read once, so its items are appended once.
 */
export function appendAll(target: Item[], source: Collection): void {
  const count = source.length;
  for (let index = 0; index < count; index++) {
    const item = source[index];
    // Always true: collections never hold undefined. The check satisfies noUncheckedIndexedAccess.
    if (item !== undefined) {
      target.push(item);
    }
  }
}
