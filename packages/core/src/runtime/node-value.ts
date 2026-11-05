import { ModelNode } from '../model/model-node.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import type { Item } from './collection.ts';

/** The 32-bit range of `System.Integer` ([N1 §4.1](https://hl7.org/fhirpath/N1/#literals)). */
const MIN_INTEGER = -(2 ** 31);
const MAX_INTEGER = 2 ** 31 - 1;

/**
 * The System value of a collection item, for operators and functions that work on System values.
 *
 * Literals and computed values are already System values and are returned unchanged. An input
 * node is converted from its JSON value, following the model-less mapping
 * ([T0003: model principles](https://github.com/losol/callis/blob/main/docs/tasks/T0003-types-and-collections.md#model-principles)):
 *
 * | JSON value | Result |
 * | --- | --- |
 * | string | `String` |
 * | boolean | `Boolean` |
 * | whole number in the 32-bit range | `Integer` (`-0` becomes `0`) |
 * | any other finite number | `Decimal`, through its shortest round-trip text |
 * | object (a resource or complex value) | the node itself |
 * | none (a primitive with only extensions) | `undefined`, which callers treat as empty |
 *
 * Callers that depend on where a value came from, such as the model-less date convenience in the
 * equality kernels, check the node before calling this. The node is never changed, and nothing is
 * cached on it.
 *
 * @example
 * ```ts
 * toSystemValue(new ModelNode({ value: 'female', name: 'gender' })); // 'female'
 * toSystemValue(new ModelNode({ value: 1.5, name: 'value' }));       // Decimal 1.5
 * toSystemValue(Decimal.ONE);                                         // Decimal.ONE, unchanged
 * ```
 */
export function toSystemValue(item: Item): Item | undefined {
  if (!(item instanceof ModelNode)) {
    return item;
  }
  // TODO(T0018): convert typed nodes through the model (FHIR.date → System.Date, …).
  const value = item.value;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (Number.isInteger(value) && value >= MIN_INTEGER && value <= MAX_INTEGER) {
        // `-0 + 0` is `0`, so a JSON `-0` does not leak a negative zero.
        return value + 0;
      }
      return Decimal.fromNumber(value);
    case 'object':
      return value === null ? undefined : item;
    default:
      return undefined;
  }
}
