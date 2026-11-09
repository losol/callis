/**
 * FHIR Quantities in the equality and ordering kernels, when one of them does not convert to a
 * `System.Quantity` ([R5 §2.1.9.1.3](https://hl7.org/fhir/R5/fhirpath.html#quantity),
 * [spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#fhir-quantities-without-a-ucum-code)).
 *
 * A FHIR Quantity with a UCUM `system` and `code` and a `value` converts to a `System.Quantity`,
 * and two of those compare like any quantities, with unit conversion. Any other FHIR Quantity, or
 * a specialization such as `Age`, stays a complex value. Two FHIR Quantities of which at least one
 * stays complex compare by their elements, as the HL7 Java engine orders them: their units match
 * when both have a `code` and the codes are the same, or when not both have one and their `unit`
 * texts are the same (two quantities without a unit match). Then their values compare as Decimals.
 */
import { JsonNumber } from '../model/lossless-json.ts';
import { ModelNode } from '../model/model-node.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { Quantity } from '../values/quantity/quantity.ts';
import type { Item } from './collection.ts';

/**
 * Two FHIR Quantities that compare by their elements: whether their units match, and their values,
 * each undefined when it has none.
 */
export type FhirQuantityPair =
  | { readonly unitsMatch: false }
  | {
      readonly unitsMatch: true;
      readonly left: Decimal | undefined;
      readonly right: Decimal | undefined;
    };

type JsonObject = Readonly<Record<string, unknown>>;

/**
 * The pair to compare when both items are FHIR Quantity nodes (by their model's System type) and
 * at least one of them does not convert to a `System.Quantity`; otherwise undefined, and the
 * operands compare as usual.
 */
export function fhirQuantityPair(left: Item, right: Item): FhirQuantityPair | undefined {
  const a = fhirQuantityJson(left);
  if (a === undefined) {
    return undefined;
  }
  const b = fhirQuantityJson(right);
  if (b === undefined || (converts(left) && converts(right))) {
    return undefined;
  }
  const codeA = ownString(a, 'code');
  const codeB = ownString(b, 'code');
  const unitsMatch =
    codeA !== undefined && codeB !== undefined
      ? codeA === codeB
      : ownString(a, 'unit') === ownString(b, 'unit');
  if (!unitsMatch) {
    return { unitsMatch };
  }
  return { unitsMatch, left: decimalOf(a), right: decimalOf(b) };
}

/**
 * `=` of the pair: undetermined when the units do not match or only one has a value, true when
 * neither has a value, otherwise whether the values are equal.
 */
export function fhirQuantityEquals(pair: FhirQuantityPair): boolean | undefined {
  if (!pair.unitsMatch) {
    return undefined;
  }
  if (pair.left === undefined || pair.right === undefined) {
    return pair.left === pair.right ? true : undefined;
  }
  return pair.left.equals(pair.right);
}

/** `~` of the pair: like `=`, except that every undetermined result is false. */
export function fhirQuantityEquivalent(pair: FhirQuantityPair): boolean {
  if (!pair.unitsMatch) {
    return false;
  }
  if (pair.left === undefined || pair.right === undefined) {
    return pair.left === pair.right;
  }
  return pair.left.equivalent(pair.right);
}

/** The order of the pair: undefined unless the units match and both have a value. */
export function fhirQuantityCompare(pair: FhirQuantityPair): -1 | 0 | 1 | undefined {
  if (!pair.unitsMatch || pair.left === undefined || pair.right === undefined) {
    return undefined;
  }
  return pair.left.compare(pair.right);
}

/** The JSON object of a node typed as a FHIR Quantity or a specialization of it. */
function fhirQuantityJson(item: Item): JsonObject | undefined {
  if (!(item instanceof ModelNode) || item.systemType !== 'Quantity') {
    return undefined;
  }
  const value = item.value;
  return isJsonObject(value) ? value : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof JsonNumber)
  );
}

function converts(node: Item): boolean {
  return node instanceof ModelNode && node.systemValue() instanceof Quantity;
}

function ownString(json: JsonObject, key: string): string | undefined {
  if (!Object.hasOwn(json, key)) {
    return undefined;
  }
  const value = json[key];
  return typeof value === 'string' ? value : undefined;
}

/** The `value` element as a Decimal; undefined when it is missing or not a number. */
function decimalOf(json: JsonObject): Decimal | undefined {
  if (!Object.hasOwn(json, 'value')) {
    return undefined;
  }
  const value = json.value;
  if (value instanceof JsonNumber) {
    return value.toDecimal();
  }
  return typeof value === 'number' ? Decimal.fromNumber(value) : undefined;
}
