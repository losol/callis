/**
 * The ordering kernel behind `<`, `<=`, `>` and `>=`, and later `sort()`.
 *
 * @see https://hl7.org/fhirpath/N1/#comparison
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import type { ModelProvider } from '../model/model-provider.ts';
import { compareTemporal } from '../values/datetime/compare.ts';
import { TimeValue } from '../values/datetime/time.ts';
import { compareQuantity } from '../values/quantity/operations.ts';
import { Quantity } from '../values/quantity/quantity.ts';
import type { UnitSystem } from '../values/quantity/unit-system.ts';
import { compareIntegers, compareStrings } from '../values/string.ts';
import type { Item } from './collection.ts';
import {
  asQuantity,
  isDateOrDateTime,
  isNumber,
  kindOf,
  type OperandKind,
  operandValue,
  toDecimal,
} from './operands.ts';

/**
 * The order of two values: `-1` if the first comes before the second, `0` if they are the same,
 * `1` if it comes after, as in `Array.prototype.sort`.
 *
 * This is the shared runtime name for the result of every ordering kernel. The value modules keep
 * their own inline unions (`-1 | 0 | 1`, `TemporalComparison`), because they must not depend on
 * the runtime; those results are assignable to `Ordering | undefined`
 * ([#57](https://github.com/losol/callis/issues/57)).
 */
export type Ordering = -1 | 0 | 1;

/**
 * What the equality and ordering kernels read from an evaluation. The evaluation context (T0008)
 * has these fields, so it can be passed as it is; the kernels never import it.
 */
export interface ComparisonContext {
  /**
   * The model of the evaluation, or undefined in model-less mode. Any model disables the
   * model-less date convenience, even for nodes whose type the model does not know.
   */
  readonly model: ModelProvider | undefined;
  /** The unit system that relates the units of quantities. */
  readonly units: UnitSystem;
  /**
   * The offset, in minutes east of UTC, for date/time values without one: 0 (UTC) unless the
   * evaluation sets `timezoneOffset`
   * ([ADR-0012](https://github.com/losol/callis/blob/main/docs/adr/0012-evaluation-defaults.md)).
   */
  readonly timezoneOffset: number;
}

/**
 * Orders two items, as the comparison operators need
 * ([N1 §6.2](https://hl7.org/fhirpath/N1/#comparison)).
 *
 * | Operands | Order |
 * | --- | --- |
 * | String | by Unicode code point |
 * | Integer, Decimal | by value; an Integer converts to a Decimal |
 * | Quantity | in a common unit; an Integer or Decimal converts to a Quantity with unit `'1'` |
 * | Date, DateTime | by time span, respecting offsets; a Date converts to a DateTime |
 * | Time | by time span |
 *
 * Input nodes are compared by their System values, including the model-less date convenience
 * ({@link operandValue}).
 *
 * @returns the order, or undefined (empty) when it is unknown: date/time values with different
 *   precisions, quantities whose units cannot be related, or an input node that has only
 *   extensions.
 * @throws {@link FhirPathEvaluationError} `eval/type-mismatch` when the types cannot be ordered:
 *   different types without an implicit conversion between them (a String and a Date, a Time and a
 *   DateTime), and types without an order (Boolean, complex values).
 *
 * @example
 * ```ts
 * compare(1, Decimal.parse('1.5'), ctx);                       // -1
 * compare(parseDate('2018-03'), parseDate('2018-03-01'), ctx); // undefined
 * compare(true, false, ctx);                                   // throws eval/type-mismatch
 * ```
 */
export function compare(left: Item, right: Item, ctx: ComparisonContext): Ordering | undefined {
  const a = operandValue(left, right, ctx.model);
  const b = operandValue(right, left, ctx.model);
  if (a === undefined || b === undefined) {
    return undefined;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return compareStrings(a, b);
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return compareIntegers(a, b);
  }
  // TODO(T0028): add Integer → Long and Long → Decimal conversions.
  if (typeof a === 'bigint' && typeof b === 'bigint') {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  if (isNumber(a) && isNumber(b)) {
    return toDecimal(a).compare(toDecimal(b));
  }
  if (a instanceof Quantity || b instanceof Quantity) {
    const quantityA = asQuantity(a);
    const quantityB = asQuantity(b);
    if (quantityA !== undefined && quantityB !== undefined) {
      return compareQuantity(quantityA, quantityB, ctx.units);
    }
  }
  if (
    (isDateOrDateTime(a) && isDateOrDateTime(b)) ||
    (a instanceof TimeValue && b instanceof TimeValue)
  ) {
    return compareTemporal(a, b, ctx.timezoneOffset);
  }
  throw typeMismatch(kindOf(a), kindOf(b));
}

function typeMismatch(a: OperandKind, b: OperandKind): FhirPathEvaluationError {
  // The message names types only: errors never include input data.
  const message =
    a === b
      ? `Cannot order two ${kindName(a)} values`
      : `Cannot compare a ${kindName(a)} value with a ${kindName(b)} value`;
  return new FhirPathEvaluationError('eval/type-mismatch', message);
}

function kindName(kind: OperandKind): string {
  return kind === 'Complex' ? 'complex' : kind;
}
