/**
 * The equality and equivalence kernels behind `=`, `!=`, `~` and `!~`, and behind the collection
 * functions that compare items (`distinct()`, `union()`, `in`, `contains`, …).
 *
 * @see https://hl7.org/fhirpath/N1/#equality
 * @see https://hl7.org/fhirpath/STU3/en/index.html#equality
 */
import { ModelNode } from '../model/model-node.ts';
import { temporalEquals, temporalEquivalent } from '../values/datetime/compare.ts';
import { quantityEquals, quantityEquivalent } from '../values/quantity/operations.ts';
import { Quantity } from '../values/quantity/quantity.ts';
import {
  booleanEquals,
  booleanEquivalent,
  integerEquals,
  integerEquivalent,
  stringEquals,
  stringEquivalent,
} from '../values/string.ts';
import type { Collection, Item } from './collection.ts';
import type { ComparisonContext } from './comparison.ts';
import { navigateChildren } from './navigation.ts';
import {
  asQuantity,
  isComplex,
  isNumber,
  isTemporal,
  operandValue,
  toDecimal,
} from './operands.ts';

/**
 * Model-specific equivalence of two complex values, such as FHIR's rules for `Coding` and
 * `CodeableConcept` ([R5 §2.1.9.1.6](https://hl7.org/fhir/R5/fhirpath.html#changes), T0020).
 *
 * It is called for every pair of input nodes holding different complex values that `~` compares,
 * including those nested inside other complex values; two nodes holding the same JSON object are
 * equivalent without a call. Return `true` or `false` to decide, or undefined to fall back to the
 * default: all child properties equivalent, recursively. `=` never calls it.
 */
export type ModelEquivalence = (
  left: ModelNode,
  right: ModelNode,
  ctx: EquivalenceContext,
) => boolean | undefined;

/**
 * What the equivalence kernels read from an evaluation: the {@link ComparisonContext}, plus an
 * optional {@link ModelEquivalence}, which T0020 supplies for FHIR.
 */
export interface EquivalenceContext extends ComparisonContext {
  readonly modelEquivalence?: ModelEquivalence | undefined;
}

/**
 * Equality (`=`) of two items ([N1 §6.1.1](https://hl7.org/fhirpath/N1/#equals)).
 *
 * | Operands | Equal when |
 * | --- | --- |
 * | String | the same code units, case-sensitive |
 * | Integer, Decimal | the same value, ignoring trailing zeros; an Integer converts to a Decimal |
 * | Boolean | the same value |
 * | Date, DateTime, Time | the same at every precision, respecting offsets; a Date converts to a DateTime |
 * | Quantity | the same in a common unit; an Integer or Decimal converts to a Quantity with unit `'1'` |
 * | complex values | the same JSON object, or all child properties equal, recursively |
 * | other combinations | never: the result is `false` |
 *
 * Input nodes are compared by their System values, including the model-less date convenience
 * ({@link operandValue}).
 *
 * @returns `true` or `false`, or undefined (empty) when equality cannot be determined: date/time
 *   values with different precisions, quantities whose units cannot be related, complex values
 *   with such a child, or an input node that has only extensions.
 */
export function itemEquals(left: Item, right: Item, ctx: ComparisonContext): boolean | undefined {
  const a = operandValue(left, right, ctx.model);
  const b = operandValue(right, left, ctx.model);
  if (a === undefined || b === undefined) {
    return undefined;
  }
  if (typeof a === 'string') {
    return typeof b === 'string' && stringEquals(a, b);
  }
  if (typeof a === 'boolean') {
    return typeof b === 'boolean' && booleanEquals(a, b);
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return integerEquals(a, b);
  }
  // TODO(T0028): add Integer → Long and Long → Decimal conversions.
  if (typeof a === 'bigint' || typeof b === 'bigint') {
    return a === b;
  }
  if (isNumber(a) && isNumber(b)) {
    return toDecimal(a).equals(toDecimal(b));
  }
  if (a instanceof Quantity || b instanceof Quantity) {
    const quantityA = asQuantity(a);
    const quantityB = asQuantity(b);
    return quantityA !== undefined && quantityB !== undefined
      ? quantityEquals(quantityA, quantityB, ctx.units)
      : false;
  }
  if (isTemporal(a) && isTemporal(b)) {
    return temporalEquals(a, b, ctx.timezoneOffset);
  }
  if (isComplex(a) && isComplex(b)) {
    return complexEquals(a, b, ctx);
  }
  return false;
}

/**
 * Equivalence (`~`) of two items ([N1 §6.1.2](https://hl7.org/fhirpath/N1/#equivalent)). Like
 * {@link itemEquals}, except:
 *
 * - Strings ignore case and treat every kind of whitespace alike
 *   ([string equivalence](https://hl7.org/fhirpath/N1/#string-equivalence)).
 * - Decimals are compared after rounding to the precision of the less precise operand.
 * - Date/time values with different precisions are not equivalent.
 * - Calendar years and months are equivalent to `'a'` and `'mo'`.
 * - Complex values go through `ctx.modelEquivalence` first, then compare their child properties
 *   for equivalence, recursively, regardless of the order of repeating items.
 *
 * Never undetermined: where equality is empty, equivalence is `false`. Two input nodes that both
 * have only extensions are equivalent; one such node and any other item are not.
 */
export function itemEquivalent(left: Item, right: Item, ctx: EquivalenceContext): boolean {
  const a = operandValue(left, right, ctx.model);
  const b = operandValue(right, left, ctx.model);
  if (a === undefined || b === undefined) {
    return a === b;
  }
  if (typeof a === 'string') {
    return typeof b === 'string' && stringEquivalent(a, b);
  }
  if (typeof a === 'boolean') {
    return typeof b === 'boolean' && booleanEquivalent(a, b);
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return integerEquivalent(a, b);
  }
  // TODO(T0028): add Integer → Long and Long → Decimal conversions.
  if (typeof a === 'bigint' || typeof b === 'bigint') {
    return a === b;
  }
  if (isNumber(a) && isNumber(b)) {
    return toDecimal(a).equivalent(toDecimal(b));
  }
  if (a instanceof Quantity || b instanceof Quantity) {
    const quantityA = asQuantity(a);
    const quantityB = asQuantity(b);
    return (
      quantityA !== undefined &&
      quantityB !== undefined &&
      quantityEquivalent(quantityA, quantityB, ctx.units)
    );
  }
  if (isTemporal(a) && isTemporal(b)) {
    return temporalEquivalent(a, b, ctx.timezoneOffset);
  }
  if (isComplex(a) && isComplex(b)) {
    return complexEquivalent(a, b, ctx);
  }
  return false;
}

/**
 * Equality (`=`) of two collections ([N1 §6.1.1](https://hl7.org/fhirpath/N1/#equals), as
 * clarified in [3.0.0](https://hl7.org/fhirpath/STU3/en/index.html#-equals)): the items are
 * compared pairwise, in order.
 *
 * @returns undefined (empty) if either collection is empty; `false` if the lengths differ or any
 *   pair is not equal; `true` if every pair is equal; otherwise undefined.
 */
export function equals(
  left: Collection,
  right: Collection,
  ctx: ComparisonContext,
): boolean | undefined {
  const count = left.length;
  if (count === 0 || right.length === 0) {
    return undefined;
  }
  if (count !== right.length) {
    return false;
  }
  let result: boolean | undefined = true;
  for (let index = 0; index < count; index++) {
    const a = left[index];
    const b = right[index];
    // Always defined: collections never hold undefined. The check satisfies noUncheckedIndexedAccess.
    if (a === undefined || b === undefined) {
      continue;
    }
    const equal = itemEquals(a, b, ctx);
    if (equal === false) {
      return false;
    }
    if (equal === undefined) {
      result = undefined;
    }
  }
  return result;
}

/**
 * Equivalence (`~`) of two collections ([N1 §6.1.2](https://hl7.org/fhirpath/N1/#equivalent)):
 * the same number of items, and each item of one paired with a different, equivalent item of the
 * other, in any order. `{} ~ {}` is `true`; an empty collection is not equivalent to a non-empty
 * one.
 */
export function equivalent(left: Collection, right: Collection, ctx: EquivalenceContext): boolean {
  const count = left.length;
  if (count !== right.length) {
    return false;
  }
  if (count === 0) {
    return true;
  }
  if (count === 1) {
    const a = left[0];
    const b = right[0];
    return a !== undefined && b !== undefined && itemEquivalent(a, b, ctx);
  }
  return hasEquivalentPairing(left, right, ctx);
}

/**
 * The JSON object behind a complex value: the value of an input node, or the item itself for
 * other objects. Undefined for anything that is not a JSON object.
 */
function jsonObjectOf(item: object): Readonly<Record<string, unknown>> | undefined {
  const value: unknown = item instanceof ModelNode ? item.value : item;
  return isJsonObject(value) ? value : undefined;
}

function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a JSON property value gives navigation at least one item. */
function hasItems(value: unknown): boolean {
  if (Array.isArray(value)) {
    // Own indices only: `some()` would also visit indices a sparse array inherits.
    for (let position = 0; position < value.length; position++) {
      if (Object.hasOwn(value, position) && hasItems(value[position])) {
        return true;
      }
    }
    return false;
  }
  return value !== null && value !== undefined;
}

/**
 * The names of the properties both objects have values for, or undefined if they differ in which
 * properties have values. As in navigation, `null`, a missing property and an empty array all mean
 * "no value", and the order of the properties does not matter.
 */
function sharedPropertyNames(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): string[] | undefined {
  const names: string[] = [];
  for (const [name, value] of Object.entries(left)) {
    if (hasItems(value)) {
      names.push(name);
    }
  }
  let rightCount = 0;
  for (const [name, value] of Object.entries(right)) {
    if (hasItems(value)) {
      if (!(Object.hasOwn(left, name) && hasItems(left[name]))) {
        return undefined;
      }
      rightCount++;
    }
  }
  return rightCount === names.length ? names : undefined;
}

/**
 * The children of a typed node by element name, from model navigation
 * ([T0018: navigation rules](https://github.com/losol/callis/blob/main/docs/tasks/T0018-model-aware-evaluation.md#navigation-rules)),
 * so a FHIR `date` child compares as a Date and a choice element by its one value. Undefined
 * without a model or for an untyped node, which compare by their JSON properties instead.
 */
function typedChildren(
  item: object,
  ctx: ComparisonContext,
): ReadonlyMap<string, Collection> | undefined {
  if (ctx.model === undefined || !(item instanceof ModelNode) || item.type === undefined) {
    return undefined;
  }
  const groups = new Map<string, Item[]>();
  for (const child of navigateChildren([item], ctx)) {
    const name = child instanceof ModelNode ? child.name : '';
    const group = groups.get(name);
    if (group === undefined) {
      groups.set(name, [child]);
    } else {
      group.push(child);
    }
  }
  return groups;
}

/**
 * Whether both nodes are FHIR Quantities (or specializations such as `Age`) that did not convert
 * to `System.Quantity` because they have no UCUM code; they reach the complex comparison as nodes.
 */
function areFhirQuantities(a: object, b: object): boolean {
  return (
    a instanceof ModelNode &&
    b instanceof ModelNode &&
    a.systemType === 'Quantity' &&
    b.systemType === 'Quantity'
  );
}

/**
 * Equality (`=`) and equivalence (`~`) of two FHIR Quantities without a UCUM code, by their
 * elements, as the HL7 Java engine compares them
 * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#fhir-quantities-without-a-ucum-code)):
 * when either has a `code`, both must have the same code; otherwise, when either has a `unit`,
 * both must have the same unit text. A mismatch is undetermined for `=` and false for `~`, like
 * quantities whose units cannot be related. Then the values compare as Decimals; two quantities
 * without a value are equal, and one without a value is undetermined.
 */
function fhirQuantityEquals(
  left: ReadonlyMap<string, Collection>,
  right: ReadonlyMap<string, Collection>,
  ctx: ComparisonContext,
  equivalence: boolean,
): boolean | undefined {
  const mismatch = equivalence ? false : undefined;
  const unitElement = left.has('code') || right.has('code') ? 'code' : 'unit';
  const leftUnit = left.get(unitElement) ?? [];
  const rightUnit = right.get(unitElement) ?? [];
  if (leftUnit.length !== rightUnit.length) {
    return mismatch;
  }
  if (leftUnit.length > 0 && equals(leftUnit, rightUnit, ctx) !== true) {
    return mismatch;
  }
  const leftValue = left.get('value') ?? [];
  const rightValue = right.get('value') ?? [];
  if (leftValue.length === 0 && rightValue.length === 0) {
    return true;
  }
  if (leftValue.length === 0 || rightValue.length === 0) {
    return mismatch;
  }
  return equivalence ? equivalent(leftValue, rightValue, ctx) : equals(leftValue, rightValue, ctx);
}

/** Whether two typed nodes have values for the same elements. */
function sameElements(
  left: ReadonlyMap<string, Collection>,
  right: ReadonlyMap<string, Collection>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const name of left.keys()) {
    if (!right.has(name)) {
      return false;
    }
  }
  return true;
}

/**
 * The items a child property gives in model-less navigation: arrays are flattened and `null` is
 * skipped, and every value is an untyped input node.
 */
function childItems(owner: object, json: Readonly<Record<string, unknown>>, name: string): Item[] {
  const parent = owner instanceof ModelNode ? owner : undefined;
  const items: Item[] = [];
  appendChildItems(items, json[name], name, parent, undefined);
  return items;
}

function appendChildItems(
  items: Item[],
  value: unknown,
  name: string,
  parent: ModelNode | undefined,
  index: number | undefined,
): void {
  if (value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (let position = 0; position < value.length; position++) {
      // Skip holes, so a sparse array never reads an index it inherits.
      if (Object.hasOwn(value, position)) {
        appendChildItems(items, value[position], name, parent, position);
      }
    }
    return;
  }
  items.push(new ModelNode({ value, name, parent, index }));
}

/**
 * Equality of complex values: all child properties equal, recursively
 * ([N1 §6.1.1](https://hl7.org/fhirpath/N1/#equals)). Repeating children compare in order. With
 * a model, two typed nodes compare by their elements; otherwise by their JSON properties.
 */
function complexEquals(a: object, b: object, ctx: ComparisonContext): boolean | undefined {
  const left = jsonObjectOf(a);
  const right = jsonObjectOf(b);
  if (left === undefined || right === undefined) {
    return a === b;
  }
  if (left === right) {
    return true;
  }
  const typedLeft = typedChildren(a, ctx);
  const typedRight = typedChildren(b, ctx);
  if (typedLeft !== undefined && typedRight !== undefined) {
    if (areFhirQuantities(a, b)) {
      return fhirQuantityEquals(typedLeft, typedRight, ctx, false);
    }
    if (!sameElements(typedLeft, typedRight)) {
      return false;
    }
    return allEqual([...typedLeft.keys()], (name) =>
      equals(typedLeft.get(name) ?? [], typedRight.get(name) ?? [], ctx),
    );
  }
  const names = sharedPropertyNames(left, right);
  if (names === undefined) {
    return false;
  }
  return allEqual(names, (name) =>
    equals(childItems(a, left, name), childItems(b, right, name), ctx),
  );
}

/** `true` if every child is equal, `false` if one is not, otherwise undefined. */
function allEqual(
  names: readonly string[],
  childEquals: (name: string) => boolean | undefined,
): boolean | undefined {
  let result: boolean | undefined = true;
  for (const name of names) {
    const equal = childEquals(name);
    if (equal === false) {
      return false;
    }
    if (equal === undefined) {
      result = undefined;
    }
  }
  return result;
}

/**
 * Equivalence of complex values: the model's rule if it decides, otherwise all child properties
 * equivalent, recursively ([N1 §6.1.2](https://hl7.org/fhirpath/N1/#equivalent)). Repeating
 * children compare regardless of order. Typed nodes compare by their elements, as in
 * {@link complexEquals}.
 */
function complexEquivalent(a: object, b: object, ctx: EquivalenceContext): boolean {
  const left = jsonObjectOf(a);
  const right = jsonObjectOf(b);
  if (left === undefined || right === undefined) {
    return a === b;
  }
  if (left === right) {
    return true;
  }
  if (ctx.modelEquivalence !== undefined && a instanceof ModelNode && b instanceof ModelNode) {
    const decided = ctx.modelEquivalence(a, b, ctx);
    if (decided !== undefined) {
      return decided;
    }
  }
  const typedLeft = typedChildren(a, ctx);
  const typedRight = typedChildren(b, ctx);
  if (typedLeft !== undefined && typedRight !== undefined) {
    if (areFhirQuantities(a, b)) {
      return fhirQuantityEquals(typedLeft, typedRight, ctx, true) === true;
    }
    if (!sameElements(typedLeft, typedRight)) {
      return false;
    }
    for (const name of typedLeft.keys()) {
      if (!equivalent(typedLeft.get(name) ?? [], typedRight.get(name) ?? [], ctx)) {
        return false;
      }
    }
    return true;
  }
  const names = sharedPropertyNames(left, right);
  if (names === undefined) {
    return false;
  }
  for (const name of names) {
    if (!equivalent(childItems(a, left, name), childItems(b, right, name), ctx)) {
      return false;
    }
  }
  return true;
}

/**
 * Whether every item of `left` can be paired with a different, equivalent item of `right`, both of
 * the same length: a perfect matching between the two collections.
 *
 * Equivalence is not transitive: decimals round to the less precise operand, so `1 ~ 1.2` and
 * `1 ~ 1.4` are true but `1.2 ~ 1.4` is false. Pairing each item with the first free equivalent
 * item can therefore fail where another pairing succeeds: `(1 | 1.2) ~ (1.2 | 1.4)` is true. The
 * greedy pass handles the usual case, and augmenting paths place the items it could not.
 */
function hasEquivalentPairing(
  left: Collection,
  right: Collection,
  ctx: EquivalenceContext,
): boolean {
  const count = left.length;
  // Not memoized: the kernels are pure, and a table of pair results would need memory quadratic
  // in the collection size.
  const pairs = (leftIndex: number, rightIndex: number): boolean => {
    const a = left[leftIndex];
    const b = right[rightIndex];
    return a !== undefined && b !== undefined && itemEquivalent(a, b, ctx);
  };
  const leftMatch = new Int32Array(count).fill(-1);
  const rightMatch = new Int32Array(count).fill(-1);
  const unmatched: number[] = [];
  for (let leftIndex = 0; leftIndex < count; leftIndex++) {
    let rightIndex = 0;
    while (rightIndex < count && (rightMatch[rightIndex] !== -1 || !pairs(leftIndex, rightIndex))) {
      rightIndex++;
    }
    if (rightIndex < count) {
      leftMatch[leftIndex] = rightIndex;
      rightMatch[rightIndex] = leftIndex;
    } else {
      unmatched.push(leftIndex);
    }
  }
  for (const leftIndex of unmatched) {
    if (!augment(leftIndex, count, pairs, leftMatch, rightMatch)) {
      return false;
    }
  }
  return true;
}

/**
 * Pairs the unmatched left item `start` by finding an augmenting path breadth-first: a chain of
 * equivalent pairs that ends at a free right item, along which every pairing shifts by one.
 */
function augment(
  start: number,
  count: number,
  pairs: (leftIndex: number, rightIndex: number) => boolean,
  leftMatch: Int32Array,
  rightMatch: Int32Array,
): boolean {
  // For each right item reached, the left item it was reached from.
  const reachedFrom = new Int32Array(count).fill(-1);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const leftIndex = queue[head] ?? start;
    for (let rightIndex = 0; rightIndex < count; rightIndex++) {
      if (reachedFrom[rightIndex] !== -1 || !pairs(leftIndex, rightIndex)) {
        continue;
      }
      reachedFrom[rightIndex] = leftIndex;
      const owner = rightMatch[rightIndex] ?? -1;
      if (owner !== -1) {
        queue.push(owner);
        continue;
      }
      // A free right item: shift every pairing along the path back to `start`.
      let free = rightIndex;
      while (free !== -1) {
        const from = reachedFrom[free] ?? start;
        const next = from === start ? -1 : (leftMatch[from] ?? -1);
        rightMatch[free] = from;
        leftMatch[from] = free;
        free = next;
      }
      return true;
    }
  }
  return false;
}
