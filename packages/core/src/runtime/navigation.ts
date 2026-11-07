/**
 * Navigation of input data ([N1 §3](https://hl7.org/fhirpath/N1/#navigation-model),
 * [T0018: navigation rules](https://github.com/losol/callis/blob/main/docs/tasks/T0018-model-aware-evaluation.md#navigation-rules)).
 *
 * Every JSON value reached from the input, objects and primitives alike, becomes a
 * {@link ModelNode}, so later operations know it came from the input (the model-less date
 * convenience in the equality kernels depends on this). Literals and computed values are never
 * nodes. Properties are read as own properties only, so a path never reaches `__proto__`,
 * `constructor` or other prototype members.
 *
 * - **Without a model**, a name is a JSON key, arrays are flattened, and `resourceType` names a
 *   resource ([T0003: model principles](https://github.com/losol/callis/blob/main/docs/tasks/T0003-types-and-collections.md#model-principles)).
 * - **With a model**, `ModelProvider.getElement()` decides what a name means for a node whose
 *   type is known: choice elements are found under their JSON key with a type suffix, FHIR
 *   primitives are merged with their `_name` extensions, and nodes get their model type and the
 *   System type it converts to. A node whose type the model does not know (an unknown
 *   `resourceType`) is navigated like plain JSON, but never gets a type from its data.
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { JsonNumber } from '../model/lossless-json.ts';
import { ModelNode } from '../model/model-node.ts';
import {
  choiceJsonName,
  type ElementInfo,
  type ModelProvider,
  type ModelTypeInfo,
} from '../model/model-provider.ts';
import { DateValue } from '../values/datetime/date.ts';
import { DateTimeValue } from '../values/datetime/datetime.ts';
import { TimeValue } from '../values/datetime/time.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { Quantity } from '../values/quantity/quantity.ts';
import { type Collection, EMPTY, type Item } from './collection.ts';

/** What listing the children of a node needs. `EvalContext` and `ComparisonContext` have it. */
export interface ModelContext {
  /** The model, or undefined for model-less navigation of plain JSON. */
  readonly model: ModelProvider | undefined;
}

/** What member navigation reads from an evaluation. `EvalContext` has these fields. */
export interface NavigationContext extends ModelContext {
  /**
   * Whether a choice element may be written with its type suffix (`Observation.valueQuantity`),
   * the `lenient.choiceSuffix` option ([ADR-0012](https://github.com/losol/callis/blob/main/docs/adr/0012-evaluation-defaults.md)).
   * Only matters with a model: without one, the suffix form is an ordinary JSON key.
   */
  readonly lenientChoiceSuffix: boolean;
}

type JsonObject = Readonly<Record<string, unknown>>;

/** Whether a value is a JSON object: not null, not an array, not a lossless number. */
function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof JsonNumber)
  );
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
  const resourceType: unknown = value.resourceType;
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
 *   `resourceType` when it has one. With a model, an object gets the type
 *   `ModelProvider.getRootType()` gives it, so a resource is typed by its `resourceType`; an
 *   object the model does not recognize stays untyped.
 *
 * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` for a value that is not JSON
 *   data, such as a function or a symbol.
 */
export function toInputCollection(
  value: unknown,
  name: string,
  model: ModelProvider | undefined = undefined,
): Collection {
  if (value === undefined || value === null) {
    return EMPTY;
  }
  const items: Item[] = [];
  appendInput(items, value, name, model);
  return items;
}

function appendInput(
  items: Item[],
  value: unknown,
  name: string,
  model: ModelProvider | undefined,
): void {
  if (value === undefined || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    forEachOwnElement(value, (element) => appendInput(items, element, name, model));
    return;
  }
  if (isItemValue(value)) {
    items.push(value);
    return;
  }
  if (isJsonObject(value)) {
    items.push(rootNode(value, resourceTypeOf(value) ?? name, model));
    return;
  }
  if (isJsonPrimitive(value)) {
    items.push(new ModelNode({ value, name }));
    return;
  }
  throw new FhirPathEvaluationError(
    'eval/invalid-argument',
    `Expected JSON data, but found a ${typeof value}`,
  );
}

function isJsonPrimitive(value: unknown): value is string | number | boolean | JsonNumber {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof JsonNumber
  );
}

/** A root node: an input object, typed by the model when it recognizes the object. */
function rootNode(value: JsonObject, name: string, model: ModelProvider | undefined): ModelNode {
  const type = model?.getRootType(value);
  return new ModelNode({
    value,
    name,
    type,
    systemType: type === undefined ? undefined : model?.getSystemType(type),
  });
}

/**
 * Navigates to the child `name` of every item: the member invocation `input.name`
 * ([N1 §5](https://hl7.org/fhirpath/N1/#path-selection)).
 *
 * Only input nodes have children; literals and computed values give empty. With a model, a node
 * with a known type is navigated by the model's elements ([T0018: navigation rules](https://github.com/losol/callis/blob/main/docs/tasks/T0018-model-aware-evaluation.md#navigation-rules)):
 *
 * - A choice element is reached by its name (`value`); its JSON key carries the type suffix
 *   (`valueQuantity`), and the node gets the type it matched. The suffix form is not an element,
 *   so it gives empty, unless `lenientChoiceSuffix` is set.
 * - A FHIR primitive is one node from `name` and `_name`: `value` is the JSON value and
 *   `primitiveElement` the `_name` object. Repeating primitives are aligned by index, and a node
 *   exists wherever either part is present.
 * - `contained` resources and `Bundle.entry.resource` take their type from `resourceType`.
 * - An element the type does not have gives empty.
 *
 * Without a model, or for a node whose type is unknown, the name is an own JSON property; an array
 * value is flattened into one node per element, in order, with its index, and `null` values and
 * elements are skipped.
 */
export function navigateMember(
  input: Collection,
  name: string,
  ctx: NavigationContext,
): Collection {
  const items: Item[] = [];
  for (const item of input) {
    appendMember(items, item, name, ctx);
  }
  return items.length === 0 ? EMPTY : items;
}

/**
 * Evaluates an identifier at the start of a path, such as `Patient` in `Patient.name`, for each
 * item of the focus ([N1 §10.1](https://hl7.org/fhirpath/N1/#models),
 * [R5 §2.1.9.1](https://hl7.org/fhir/R5/fhirpath.html#rules),
 * [T0018: navigation rules](https://github.com/losol/callis/blob/main/docs/tasks/T0018-model-aware-evaluation.md#navigation-rules)).
 *
 * - With a model, an identifier that names one of its resource, complex or backbone types is a
 *   type name: the result is each item whose model type is that type or a subtype of it
 *   (`DomainResource.contained` on a Patient), and empty for the others. A primitive type name
 *   (`id`, `code`, `date`) is always an element name, as the FHIR elements of those names are;
 *   so is any other name.
 * - Without a model, an identifier that equals the item's own `resourceType` names its type, and
 *   the result is the item itself.
 * - Otherwise it is an ordinary path step to the child `name`.
 */
export function navigateRoot(focus: Collection, name: string, ctx: NavigationContext): Collection {
  const model = ctx.model;
  if (model !== undefined) {
    const type = model.getType(name);
    if (type === undefined || type.kind === 'primitive') {
      return navigateMember(focus, name, ctx);
    }
    const items: Item[] = [];
    for (const item of focus) {
      if (
        item instanceof ModelNode &&
        item.type !== undefined &&
        model.isSubtypeOf(item.type, type)
      ) {
        items.push(item);
      }
    }
    return items.length === 0 ? EMPTY : items;
  }
  const items: Item[] = [];
  for (const item of focus) {
    if (hasResourceType(item, name)) {
      items.push(item);
    } else {
      appendMember(items, item, name, ctx);
    }
  }
  return items.length === 0 ? EMPTY : items;
}

/**
 * The children of every item, for `children()` and `descendants()`
 * ([N1 §5.8](https://hl7.org/fhirpath/N1/#children-collection)).
 *
 * With a model, the children of a typed node are its elements in the model's definition order
 * (`ModelProvider.getElements()`), navigated as {@link navigateMember} does, so a choice element
 * gives its one value and a FHIR primitive is merged with its `_name` extensions; the children of
 * a typed primitive are its `id` and `extension`. Without a model, or for an untyped node, the
 * children are the JSON properties in document order, except `resourceType`, which names the
 * type, and keys starting with `_`, which are not elements. Items that are not nodes have no
 * children.
 */
export function navigateChildren(input: Collection, ctx: ModelContext): Collection {
  const items: Item[] = [];
  for (const item of input) {
    if (!(item instanceof ModelNode)) {
      continue;
    }
    const model = ctx.model;
    if (model !== undefined && item.type !== undefined) {
      const source = sourceOf(item, item.type);
      if (source !== undefined) {
        for (const element of model.getElements(item.type)) {
          appendTypedElement(items, source, element, element.name, item, model);
        }
      }
      continue;
    }
    const json = item.value;
    if (!isJsonObject(json)) {
      continue;
    }
    for (const key of Object.keys(json)) {
      if (key !== 'resourceType' && !key.startsWith('_')) {
        appendChild(items, json[key], key, item);
      }
    }
  }
  return items.length === 0 ? EMPTY : items;
}

function appendMember(items: Item[], item: Item, name: string, ctx: NavigationContext): void {
  if (!(item instanceof ModelNode)) {
    return;
  }
  const model = ctx.model;
  if (model !== undefined && item.type !== undefined) {
    appendTypedMember(items, item, item.type, name, model, ctx.lenientChoiceSuffix);
    return;
  }
  const json = item.value;
  if (isJsonObject(json) && Object.hasOwn(json, name)) {
    appendChild(items, json[name], name, item);
  }
}

/** Model-less: the own property `value` of a node, flattened. */
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

/** With a model: the element `name` of a node of `type`. */
function appendTypedMember(
  items: Item[],
  node: ModelNode,
  type: ModelTypeInfo,
  name: string,
  model: ModelProvider,
  lenientChoiceSuffix: boolean,
): void {
  const source = sourceOf(node, type);
  if (source === undefined) {
    return;
  }
  const element = model.getElement(type, name);
  if (element !== undefined) {
    appendTypedElement(items, source, element, name, node, model);
    return;
  }
  // TODO(T0024): an unknown element is a semantic error with analysis, and an error in strict mode.
  if (lenientChoiceSuffix) {
    const choice = findChoiceBySuffix(model, type, name);
    if (choice !== undefined) {
      appendElementValue(items, source, name, choice.element.name, choice.typeName, node, model);
    }
  }
}

/**
 * The JSON object the elements of a node are read from: the value of a resource or complex
 * value, and the `_name` object of a FHIR primitive, which holds its `id` and `extension`.
 */
function sourceOf(node: ModelNode, type: ModelTypeInfo): JsonObject | undefined {
  const source = type.kind === 'primitive' ? node.primitiveElement : node.value;
  return isJsonObject(source) ? source : undefined;
}

/** An element of a typed node: a choice element gives the one type that is present. */
function appendTypedElement(
  items: Item[],
  source: JsonObject,
  element: ElementInfo,
  name: string,
  parent: ModelNode,
  model: ModelProvider,
): void {
  if (!element.isChoice) {
    const typeName = element.typeNames[0];
    if (typeName !== undefined) {
      appendElementValue(items, source, name, name, typeName, parent, model);
    }
    return;
  }
  for (const typeName of element.typeNames) {
    const key = choiceJsonName(name, typeName);
    if (Object.hasOwn(source, key) || Object.hasOwn(source, `_${key}`)) {
      appendElementValue(items, source, key, name, typeName, parent, model);
      return;
    }
  }
}

/**
 * With `lenientChoiceSuffix`: the choice element and type that the JSON key `name` stands for,
 * such as `value` and `Quantity` for `valueQuantity`.
 */
function findChoiceBySuffix(
  model: ModelProvider,
  type: ModelTypeInfo,
  name: string,
): { readonly element: ElementInfo; readonly typeName: string } | undefined {
  for (const element of model.getElements(type)) {
    if (
      !element.isChoice ||
      !name.startsWith(element.name) ||
      name.length === element.name.length
    ) {
      continue;
    }
    for (const typeName of element.typeNames) {
      if (choiceJsonName(element.name, typeName) === name) {
        return { element, typeName };
      }
    }
  }
  return undefined;
}

/**
 * The nodes of one element value: the JSON property `key` of `source`, as nodes named `name` of
 * the model type `typeName`. A primitive is merged with the `_key` property.
 */
function appendElementValue(
  items: Item[],
  source: JsonObject,
  key: string,
  name: string,
  typeName: string,
  parent: ModelNode,
  model: ModelProvider,
): void {
  const type = model.getType(typeName);
  const value = Object.hasOwn(source, key) ? source[key] : undefined;
  if (type?.kind === 'primitive') {
    const extensionKey = `_${key}`;
    const extensions = Object.hasOwn(source, extensionKey) ? source[extensionKey] : undefined;
    appendPrimitive(items, value, extensions, name, type, parent, model);
    return;
  }
  appendComplex(items, value, name, type, parent, model);
}

/**
 * The nodes of a FHIR primitive element ([FHIR JSON](https://hl7.org/fhir/R4/json.html#primitive)):
 * `value` and `extensions` (`name` and `_name`) form one node, or one node per index when they
 * repeat. A `null` in either array is a placeholder, and a node exists where either part is.
 */
function appendPrimitive(
  items: Item[],
  value: unknown,
  extensions: unknown,
  name: string,
  type: ModelTypeInfo,
  parent: ModelNode,
  model: ModelProvider,
): void {
  const systemType = model.getSystemType(type);
  if (!Array.isArray(value) && !Array.isArray(extensions)) {
    const primitiveElement = isJsonObject(extensions) ? extensions : undefined;
    if ((value !== undefined && value !== null) || primitiveElement !== undefined) {
      items.push(
        new ModelNode({
          value: value === null ? undefined : value,
          name,
          type,
          systemType,
          parent,
          primitiveElement,
        }),
      );
    }
    return;
  }
  const values: readonly unknown[] = Array.isArray(value) ? value : value == null ? [] : [value];
  const elements: readonly unknown[] = Array.isArray(extensions) ? extensions : [];
  const count = Math.max(values.length, elements.length);
  for (let index = 0; index < count; index++) {
    const item = ownElement(values, index);
    const extension = ownElement(elements, index);
    const primitiveElement = isJsonObject(extension) ? extension : undefined;
    // An array inside a primitive array is not valid FHIR JSON; it is skipped rather than nested.
    const primitive = Array.isArray(item) ? undefined : item;
    if (primitive === undefined && primitiveElement === undefined) {
      continue;
    }
    items.push(
      new ModelNode({ value: primitive, name, type, systemType, parent, index, primitiveElement }),
    );
  }
}

/** The own element at `index`, with `null` as undefined. */
function ownElement(array: readonly unknown[], index: number): unknown {
  if (!Object.hasOwn(array, index)) {
    return undefined;
  }
  const value = array[index];
  return value === null ? undefined : value;
}

/** The nodes of a resource, complex or backbone element, flattened like plain JSON. */
function appendComplex(
  items: Item[],
  value: unknown,
  name: string,
  type: ModelTypeInfo | undefined,
  parent: ModelNode,
  model: ModelProvider,
): void {
  if (value === undefined || value === null) {
    return;
  }
  if (!Array.isArray(value)) {
    items.push(complexNode(value, name, type, parent, undefined, model));
    return;
  }
  forEachOwnElement(value, (element, index) => {
    if (Array.isArray(element)) {
      appendComplex(items, element, name, type, parent, model);
    } else if (element !== undefined && element !== null) {
      items.push(complexNode(element, name, type, parent, index, model));
    }
  });
}

/**
 * A node of a complex element. An element typed as a resource (`contained`,
 * `Bundle.entry.resource`) takes its type from the object's `resourceType`, falling back to the
 * declared type when the model does not know it.
 */
function complexNode(
  value: unknown,
  name: string,
  declared: ModelTypeInfo | undefined,
  parent: ModelNode,
  index: number | undefined,
  model: ModelProvider,
): ModelNode {
  let type = declared;
  if (declared?.kind === 'resource' && isJsonObject(value)) {
    type = model.getRootType(value) ?? declared;
  }
  return new ModelNode({
    value,
    name,
    type,
    systemType: type === undefined ? undefined : model.getSystemType(type),
    parent,
    index,
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
