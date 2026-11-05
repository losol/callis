/**
 * The operands of the equality and ordering kernels as System values, with the implicit
 * conversions those kernels apply.
 *
 * @see https://hl7.org/fhirpath/N1/#equality
 * @see https://hl7.org/fhirpath/N1/#comparison
 * @see https://hl7.org/fhirpath/N1/#conversion
 */
import { ModelNode } from '../model/model-node.ts';
import type { ModelProvider } from '../model/model-provider.ts';
import { DateValue } from '../values/datetime/date.ts';
import { DateTimeValue } from '../values/datetime/datetime.ts';
import { parseDate, parseDateTime, parseTime } from '../values/datetime/parse.ts';
import type { TemporalValue } from '../values/datetime/temporal-value.ts';
import { TimeValue } from '../values/datetime/time.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { Quantity } from '../values/quantity/quantity.ts';
import type { Item } from './collection.ts';
import { toSystemValue } from './node-value.ts';

/**
 * The kind of a System value as the kernels see it. `Complex` covers resources and complex values
 * (input nodes with an object value). `Long` is phase 2 (T0028).
 */
export type OperandKind =
  | 'Boolean'
  | 'String'
  | 'Integer'
  | 'Long'
  | 'Decimal'
  | 'Date'
  | 'DateTime'
  | 'Time'
  | 'Quantity'
  | 'Complex';

/**
 * The System value of `item` when it is compared with `other`, or `undefined` when the item
 * behaves as empty (a FHIR primitive with only extensions).
 *
 * This is {@link toSystemValue} plus the Callis model-less date convenience
 * ([T0009](https://github.com/losol/callis/blob/main/docs/tasks/T0009-equality-kernels.md#model-less-date-convenience),
 * [#55](https://github.com/losol/callis/issues/55)): without a model, a string from untyped input
 * data is read as a date/time when the other operand is one, so `birthDate = @1974-12-25` works
 * on plain JSON. The rule is symmetric because each kernel converts both operands with this
 * function, each against the other. It is not a general String → date/time conversion:
 *
 * - Only an input {@link ModelNode} without a model type, holding a JavaScript string, is
 *   eligible, and only when no model is supplied. String literals and computed strings are never
 *   eligible.
 * - A Date or DateTime on the other side parses date-only text with `parseDate()` and text with a
 *   time part with `parseDateTime()`; a Time parses it with `parseTime()`. The ordinary temporal
 *   rules then apply, including partial precision and Date → DateTime conversion.
 * - Text that does not parse stays a String, so the normal cross-type rules apply.
 *
 * The node is neither changed nor given a cached value, so a later String operation on the same
 * node still sees a String.
 *
 * @param item - The operand, possibly an input node.
 * @param other - The other operand, possibly an input node.
 * @param model - The model of the evaluation; any model disables the date convenience.
 */
export function operandValue(
  item: Item,
  other: Item,
  model: ModelProvider | undefined,
): Item | undefined {
  const value = toSystemValue(item);
  if (
    model !== undefined ||
    typeof value !== 'string' ||
    !(item instanceof ModelNode) ||
    item.type !== undefined
  ) {
    return value;
  }
  const target = toSystemValue(other);
  if (target instanceof TimeValue) {
    return parseTime(value) ?? value;
  }
  if (target instanceof DateValue || target instanceof DateTimeValue) {
    return (value.includes('T') ? parseDateTime(value) : parseDate(value)) ?? value;
  }
  return value;
}

/** The {@link OperandKind} of a System value returned by {@link operandValue}. */
export function kindOf(value: Item): OperandKind {
  switch (typeof value) {
    case 'boolean':
      return 'Boolean';
    case 'string':
      return 'String';
    case 'number':
      return 'Integer';
    case 'bigint':
      return 'Long';
    default:
      break;
  }
  if (value instanceof Decimal) {
    return 'Decimal';
  }
  if (value instanceof DateValue) {
    return 'Date';
  }
  if (value instanceof DateTimeValue) {
    return 'DateTime';
  }
  if (value instanceof TimeValue) {
    return 'Time';
  }
  if (value instanceof Quantity) {
    return 'Quantity';
  }
  return 'Complex';
}

/** Whether a value is complex: a resource or complex value from the input, not a System value. */
export function isComplex(value: Item): value is object {
  return kindOf(value) === 'Complex';
}

/** Whether a value is an Integer or a Decimal. */
export function isNumber(value: Item): value is number | Decimal {
  return typeof value === 'number' || value instanceof Decimal;
}

/** Whether a value is a Date, DateTime or Time. */
export function isTemporal(value: Item): value is TemporalValue {
  return isDateOrDateTime(value) || value instanceof TimeValue;
}

/** Whether a value is a Date or a DateTime, which compare with each other (Date → DateTime). */
export function isDateOrDateTime(value: Item): value is DateValue | DateTimeValue {
  return value instanceof DateValue || value instanceof DateTimeValue;
}

/**
 * The implicit Integer → Decimal conversion ([N1 §5.5](https://hl7.org/fhirpath/N1/#conversion)).
 * A Decimal is returned unchanged.
 */
export function toDecimal(value: number | Decimal): Decimal {
  return typeof value === 'number' ? Decimal.fromInteger(value) : value;
}

/**
 * A value as a Quantity: a Quantity unchanged, and an Integer or Decimal through the implicit
 * conversion to the unit `'1'` ([3.0.0 conversion](https://hl7.org/fhirpath/STU3/#conversion):
 * `23 = 23 '1'` is true). Undefined for any other value.
 */
export function asQuantity(value: Item): Quantity | undefined {
  if (value instanceof Quantity) {
    return value;
  }
  return isNumber(value) ? new Quantity(toDecimal(value), '1') : undefined;
}
