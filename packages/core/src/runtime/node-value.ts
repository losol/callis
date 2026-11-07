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
