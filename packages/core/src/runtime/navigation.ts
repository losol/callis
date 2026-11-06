/**
 * Model-less navigation of plain JSON ([N1 §3](https://hl7.org/fhirpath/N1/#navigation-model),
 * [T0003: model principles](https://github.com/losol/callis/blob/main/docs/tasks/T0003-types-and-collections.md#model-principles)).
 *
 * Every JSON value reached from the input, objects and primitives alike, becomes a
 * {@link ModelNode}, so later operations know it came from the input (the model-less date
 * convenience in the equality kernels depends on this). Literals and computed values are never
 * nodes. Properties are read as own properties only, so a path never reaches `__proto__`,
 * `constructor` or other prototype members. Model-aware navigation (choice types, primitive
 * extensions) is T0018.
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { ModelNode } from '../model/model-node.ts';
import { DateValue } from '../values/datetime/date.ts';
import { DateTimeValue } from '../values/datetime/datetime.ts';
import { TimeValue } from '../values/datetime/time.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { Quantity } from '../values/quantity/quantity.ts';
import { type Collection, EMPTY, type Item } from './collection.ts';

/** Whether a value is a JSON object: not null, not an array. */
function isJsonObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The own `resourceType` of a JSON object, if it is a string. Inherited properties and other
 * values do not count.
 *
 * This one rule decides both the model-less root identifier (`Patient.name` on a Patient) and
 * the model-less resource-name type test (`contained[0] is Patient`), so navigation and type tests
 * agree ([T0008: resource type names without a model](https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#resource-type-names-without-a-model)).
 */
export function resourceTypeOf(value: unknown): string | undefined {
  if (!isJsonObject(value) || !Object.hasOwn(value, 'resourceType')) {
    return undefined;
  }
  const resourceType: unknown = (value as Readonly<Record<string, unknown>>).resourceType;
  return typeof resourceType === 'string' ? resourceType : undefined;
}

/** Whether an item is an input node whose JSON object has the own `resourceType` `name`. */
export function hasResourceType(item: Item, name: string): boolean {
  return item instanceof ModelNode && resourceTypeOf(item.value) === name;
}

/** Whether a value is already a collection item: a value class, a node or a `bigint`. */
function isItemValue(value: unknown): value is Item {
  return (
    value instanceof ModelNode ||
    value instanceof Decimal ||
    value instanceof DateValue ||
    value instanceof DateTimeValue ||
    value instanceof TimeValue ||
    value instanceof Quantity ||
    typeof value === 'bigint'
  );
}

/**
 * Turns a value supplied by the host, the evaluation input or a variable, into a collection.
 *
 * - `undefined`, `null` and `[]` are empty ([N1 §9](https://hl7.org/fhirpath/N1/#environment-variables)).
 * - An array gives one item per element, flattened; `null` elements are skipped.
 * - A node, a value class (`Decimal`, `DateValue`, `Quantity`, …) or a `bigint` is used as it is.
 * - Any other JSON value, object or primitive, becomes an input node named `name`, or by its
 *   `resourceType` when it has one.
 *
 * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` for a value that is not JSON
 *   data, such as a function or a symbol.
 */
export function toInputCollection(value: unknown, name: string): Collection {
  if (value === undefined || value === null) {
    return EMPTY;
  }
  const items: Item[] = [];
  appendInput(items, value, name);
  return items;
}

function appendInput(items: Item[], value: unknown, name: string): void {
  if (value === undefined || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    forEachOwnElement(value, (element) => appendInput(items, element, name));
    return;
  }
  if (isItemValue(value)) {
    items.push(value);
    return;
  }
  if (typeof value === 'object' || isJsonPrimitive(value)) {
    items.push(new ModelNode({ value, name: resourceTypeOf(value) ?? name }));
    return;
  }
  throw new FhirPathEvaluationError(
    'eval/invalid-argument',
    `Expected JSON data, but found a ${typeof value}`,
  );
}

function isJsonPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * Navigates to the child `name` of every item: the member invocation `input.name`
 * ([N1 §5](https://hl7.org/fhirpath/N1/#path-selection)).
 *
 * Only input nodes with a JSON object value have children. The property must be an own property;
 * an array value is flattened into one node per element, in order, with its index, and `null`
 * values and elements are skipped. Other items (literals, computed values, primitive nodes) have
 * no children, so the result for them is empty.
 */
export function navigateMember(input: Collection, name: string): Collection {
  const items: Item[] = [];
  for (const item of input) {
    appendMember(items, item, name);
  }
  return items.length === 0 ? EMPTY : items;
}

/**
 * Evaluates an identifier at the start of a path, such as `Patient` in `Patient.name`, for each
 * item of the focus.
 *
 * Without a model, an identifier that equals the item's own `resourceType` names its type, and
 * the result is the item itself ([N1 §10.1](https://hl7.org/fhirpath/N1/#models),
 * [T0018: navigation rules](https://github.com/losol/callis/blob/main/docs/tasks/T0018-model-aware-evaluation.md#navigation-rules)).
 * Otherwise it is an ordinary path step to the child `name`.
 */
export function navigateRoot(focus: Collection, name: string): Collection {
  // TODO(T0018): with a model, a root identifier names a model type and matches subtypes.
  const items: Item[] = [];
  for (const item of focus) {
    if (hasResourceType(item, name)) {
      items.push(item);
    } else {
      appendMember(items, item, name);
    }
  }
  return items.length === 0 ? EMPTY : items;
}

function appendMember(items: Item[], item: Item, name: string): void {
  if (!(item instanceof ModelNode) || !isJsonObject(item.value)) {
    return;
  }
  const json = item.value;
  if (Object.hasOwn(json, name)) {
    appendChild(items, (json as Readonly<Record<string, unknown>>)[name], name, item);
  }
}

function appendChild(items: Item[], value: unknown, name: string, parent: ModelNode): void {
  if (value === undefined || value === null) {
    return;
  }
  if (!Array.isArray(value)) {
    items.push(new ModelNode({ value, name, parent }));
    return;
  }
  forEachOwnElement(value, (element, index) => {
    if (Array.isArray(element)) {
      // FHIR JSON never nests arrays; if some input does, its elements are flattened in order.
      appendChild(items, element, name, parent);
    } else if (element !== undefined && element !== null) {
      items.push(new ModelNode({ value: element, name, parent, index }));
    }
  });
}

/**
 * Calls `fn` for each own element of an array, in index order, with its index. Holes and elements
 * inherited from a prototype are skipped: an array iterator (`for...of`) would read those too.
 */
function forEachOwnElement(
  array: readonly unknown[],
  fn: (element: unknown, index: number) => void,
): void {
  const length = array.length;
  for (let index = 0; index < length; index++) {
    if (Object.hasOwn(array, index)) {
      fn(array[index], index);
    }
  }
}
