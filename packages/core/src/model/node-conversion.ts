/**
 * How an input node converts to a System value
 * ([T0018: ModelNode](https://github.com/losol/callis/blob/main/docs/tasks/T0018-model-aware-evaluation.md#modelnode),
 * [R5 §2.1.9.1.2](https://hl7.org/fhir/R5/fhirpath.html#types)).
 *
 * A node with a System type from the model converts by that type: the FHIR primitive rules, with
 * `FHIR.date` as `System.Date` and a `Quantity` as `System.Quantity` when it has a UCUM code
 * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#fhirdate-maps-to-systemdate)).
 * A value that is not valid for its type, such as a malformed date or a string where a Boolean is
 * expected, keeps the plain JSON mapping rather than raising an error: FHIRPath navigates the data
 * it is given and does not validate it. A node without a System type, from model-less navigation
 * or a complex type, follows the plain JSON mapping
 * ([T0003: model principles](https://github.com/losol/callis/blob/main/docs/tasks/T0003-types-and-collections.md#model-principles)):
 *
 * | JSON value | Result |
 * | --- | --- |
 * | string | `String` |
 * | boolean | `Boolean` |
 * | whole number in the 32-bit range | `Integer` (`-0` becomes `0`) |
 * | any other finite number | `Decimal`, through its shortest round-trip text |
 * | `JsonNumber` written as a whole number in the 32-bit range | `Integer` |
 * | any other `JsonNumber` | `Decimal`, with the precision of the text |
 * | object (a resource or complex value) | the node itself |
 * | none (a primitive with only extensions) | `undefined`, which callers treat as empty |
 */
import { parseDate, parseDateTime, parseTime } from '../values/datetime/parse.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { fromFhirQuantity } from '../values/quantity/fhir-quantity.ts';
import { JsonNumber } from './lossless-json.ts';
import type { ModelNode, SystemValue } from './model-node.ts';

/** The 32-bit range of `System.Integer` ([N1 §4.1](https://hl7.org/fhirpath/N1/#literals)). */
const MIN_INTEGER = -(2 ** 31);
const MAX_INTEGER = 2 ** 31 - 1;

const INTEGER_TEXT = /^-?[0-9]+$/;

/** The System value of a node, by its System type when it has one; see the module notes. */
export function convertNode(node: ModelNode): SystemValue | undefined {
  const value = node.value;
  if (value === undefined || value === null) {
    return undefined;
  }
  const converted = convertTyped(node.systemType, value);
  return converted === undefined ? plainValue(node, value) : converted;
}

function convertTyped(
  systemType: ModelNode['systemType'],
  value: unknown,
): SystemValue | undefined {
  switch (systemType) {
    case 'Boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'String':
      return typeof value === 'string' ? value : undefined;
    case 'Integer':
      return toInteger(value);
    case 'Long':
      return toLong(value);
    case 'Decimal':
      return toDecimal(value);
    case 'Date':
      return typeof value === 'string' ? parseDate(value) : undefined;
    case 'DateTime':
      return typeof value === 'string' ? parseDateTime(value) : undefined;
    case 'Time':
      return typeof value === 'string' ? parseTime(value) : undefined;
    case 'Quantity':
      return fromFhirQuantity(value, toDecimal);
    case undefined:
      return undefined;
  }
}

/** The plain JSON mapping of a value, used without a System type and as the fallback. */
function plainValue(node: ModelNode, value: unknown): SystemValue | undefined {
  switch (typeof value) {
    case 'string':
    case 'boolean':
    case 'bigint':
      return value;
    case 'number':
      return toInteger(value) ?? Decimal.fromNumber(value);
    case 'object':
      if (value instanceof JsonNumber) {
        return value.toInteger() ?? value.toDecimal();
      }
      return node;
    default:
      return undefined;
  }
}

/** A `System.Integer` from a number or a {@link JsonNumber} written as one. */
function toInteger(value: unknown): number | undefined {
  if (typeof value === 'number') {
    // `-0 + 0` is `0`, so a JSON `-0` does not leak a negative zero.
    return Number.isInteger(value) && value >= MIN_INTEGER && value <= MAX_INTEGER
      ? value + 0
      : undefined;
  }
  return value instanceof JsonNumber ? value.toInteger() : undefined;
}

/**
 * A `System.Long` (phase 2) from a whole number, a {@link JsonNumber} written as one, or the JSON
 * string that R5 uses for `integer64`.
 */
function toLong(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? BigInt(value) : undefined;
  }
  const text = value instanceof JsonNumber ? value.text : value;
  return typeof text === 'string' && INTEGER_TEXT.test(text) ? BigInt(text) : undefined;
}

/** A `System.Decimal` from a number, a {@link JsonNumber} or a `Decimal`. */
function toDecimal(value: unknown): Decimal | undefined {
  if (value instanceof Decimal) {
    return value;
  }
  if (typeof value === 'number') {
    return Decimal.fromNumber(value);
  }
  return value instanceof JsonNumber ? value.toDecimal() : undefined;
}
