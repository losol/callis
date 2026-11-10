import { ModelNode } from '../model/model-node.ts';
import type { Item } from './collection.ts';

/**
 * The System value of a collection item, for operators and functions that work on System values.
 *
 * Literals and computed values are already System values and are returned unchanged. An input
 * node gives its {@link ModelNode.systemValue}: a FHIR primitive converts by the System type the
 * model gives it (`FHIR.date` → `DateValue`), a plain JSON value by its JavaScript type, and a
 * resource or complex value is the node itself. The rules, including lossless JSON numbers, are in
 * `model/node-conversion.ts`. The result is computed once per node and remembered; the node is
 * otherwise never changed.
 *
 * Callers that depend on where a value came from, such as the model-less date convenience in the
 * equality kernels, check the node before calling this.
 *
 * @returns the System value, or undefined for a node that holds nothing (a primitive with only
 *   extensions), which callers treat as empty.
 *
 * @example
 * ```ts
 * toSystemValue(new ModelNode({ value: 'female', name: 'gender' })); // 'female'
 * toSystemValue(new ModelNode({ value: 1.5, name: 'value' }));       // Decimal 1.5
 * toSystemValue(Decimal.ONE);                                         // Decimal.ONE, unchanged
 * ```
 */
export function toSystemValue(item: Item): Item | undefined {
  return item instanceof ModelNode ? item.systemValue() : item;
}

/**
 * Whether two items are the same input node: the same object, or two nodes for the same element
 * of the same input, as when an expression reaches one element twice. Each level up to the root
 * must have the same element name, position and JSON, and the roots the same JSON value. Values
 * are not compared, so this also recognizes an element that holds only extensions, which `=`
 * cannot: `repeat()` uses it to find such an element only once.
 */
export function isSameNode(a: Item, b: Item): boolean {
  if (a === b) {
    return true;
  }
  let left: ModelNode | undefined = a instanceof ModelNode ? a : undefined;
  let right: ModelNode | undefined = b instanceof ModelNode ? b : undefined;
  while (left !== undefined && right !== undefined) {
    if (left === right) {
      return true;
    }
    if (left.value !== right.value || left.primitiveElement !== right.primitiveElement) {
      return false;
    }
    if (left.parent === undefined || right.parent === undefined) {
      // A root is named by the caller, so roots compare by their JSON value only.
      return left.parent === right.parent && typeof left.value === 'object' && left.value !== null;
    }
    if (left.name !== right.name || left.index !== right.index) {
      return false;
    }
    left = left.parent;
    right = right.parent;
  }
  return false;
}
