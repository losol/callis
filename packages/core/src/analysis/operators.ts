/**
 * The operator rules at the type level: which operand types an operator accepts and what it
 * returns. They mirror the runtime kernels (`runtime/arithmetic.ts`, `runtime/comparison.ts`,
 * `runtime/equality.ts`), so that analysis reports exactly the operand types that would raise
 * `eval/type-mismatch`, and nothing that would evaluate
 * ([N1 §6](https://hl7.org/fhirpath/N1/#operations)).
 */
import type { ModelProvider } from '../model/model-provider.ts';
import type { SystemTypeName } from '../types/system-types.ts';
import { type AnalysisType, isOpenType, systemNameOf, type TypeSet } from './inferred-type.ts';

/**
 * The kind of a value as the kernels see it: its System type, or `Complex` for a resource or a
 * complex value. `Long` is phase 2 (T0028): a `Long` value is not classified, so nothing is
 * reported for it.
 */
export type ValueKind = Exclude<SystemTypeName, 'Any' | 'Long'> | 'Complex';

/** Every kind, for asking whether a kind takes part in an operator at all. */
export const VALUE_KINDS: readonly ValueKind[] = Object.freeze([
  'Boolean',
  'String',
  'Integer',
  'Decimal',
  'Date',
  'DateTime',
  'Time',
  'Quantity',
  'Complex',
]);

/** Whether a kind is a Date, DateTime or Time. */
export function isTemporalKind(kind: ValueKind): boolean {
  return kind === 'Date' || kind === 'DateTime' || kind === 'Time';
}

/**
 * The kind of values of a type, or undefined when it cannot be told: a `Long` (T0028), or an
 * abstract model type, which may be any of its subtypes.
 */
export function kindOfType(
  type: AnalysisType,
  model: ModelProvider | undefined,
): ValueKind | undefined {
  const name = systemNameOf(type, model);
  if (name === undefined) {
    // An abstract type may be any of its subtypes, a primitive among them.
    return type.namespace === 'System' || isOpenType(type, model) ? undefined : 'Complex';
  }
  return name === 'Long' ? undefined : name;
}

/** The kinds of the possible types, or undefined when any of them cannot be told. */
export function kindsOf(
  types: TypeSet,
  model: ModelProvider | undefined,
): readonly ValueKind[] | undefined {
  if (types === undefined) {
    return undefined;
  }
  const kinds: ValueKind[] = [];
  for (const type of types) {
    const kind = kindOfType(type, model);
    if (kind === undefined) {
      return undefined;
    }
    if (!kinds.includes(kind)) {
      kinds.push(kind);
    }
  }
  return kinds;
}

/** The math operators, including the String concatenation `+`; `&` is checked separately. */
export type ArithmeticOperator = '+' | '-' | '*' | '/' | 'div' | 'mod';

function isNumber(kind: ValueKind): boolean {
  return kind === 'Integer' || kind === 'Decimal';
}

/**
 * The kind of the result of a math operator on two kinds, or undefined when the operator does
 * not accept them (`eval/type-mismatch` at runtime): numbers; `+` on two Strings; a Date,
 * DateTime or Time plus or minus a Quantity; and `+`, `-`, `*` and `/` on quantities, where a
 * number converts to a Quantity ([N1 §6.6](https://hl7.org/fhirpath/N1/#math),
 * [§6.7](https://hl7.org/fhirpath/N1/#datetime-arithmetic)).
 */
export function arithmeticResult(
  op: ArithmeticOperator,
  a: ValueKind,
  b: ValueKind,
): ValueKind | undefined {
  if (isNumber(a) && isNumber(b)) {
    return op === '/' ? 'Decimal' : a === 'Integer' && b === 'Integer' ? 'Integer' : 'Decimal';
  }
  if (op === '+' && a === 'String' && b === 'String') {
    return 'String';
  }
  if ((op === '+' || op === '-') && isTemporalKind(a) && b === 'Quantity') {
    return a;
  }
  if (op !== 'div' && op !== 'mod' && (a === 'Quantity' || b === 'Quantity')) {
    return (isNumber(a) || a === 'Quantity') && (isNumber(b) || b === 'Quantity')
      ? 'Quantity'
      : undefined;
  }
  return undefined;
}

/**
 * Whether the ordering operators accept two kinds ([N1 §6.2](https://hl7.org/fhirpath/N1/#comparison)):
 * two Strings, two numbers, a Quantity with a Quantity or a number, a Date or DateTime with
 * either, and two Times. Anything else raises `eval/type-mismatch` at runtime.
 */
export function isComparable(a: ValueKind, b: ValueKind): boolean {
  if (a === 'String' || a === 'Time') {
    return a === b;
  }
  if (isNumber(a)) {
    return isNumber(b) || b === 'Quantity';
  }
  if (a === 'Quantity') {
    return isNumber(b) || b === 'Quantity';
  }
  if (a === 'Date' || a === 'DateTime') {
    return b === 'Date' || b === 'DateTime';
  }
  return false;
}

/**
 * Whether `=` and `~` can relate two kinds at all ([N1 §6.1](https://hl7.org/fhirpath/N1/#equality)):
 * the same kind, a number with a number or a Quantity, and a Date with a DateTime. Values of
 * other kinds are never equal, which strict mode reports as a type mismatch
 * ([N1 §11](https://hl7.org/fhirpath/N1/#type-safety-and-strict-evaluation)).
 */
export function isEquatable(a: ValueKind, b: ValueKind): boolean {
  return a === b || isComparable(a, b);
}

/** Whether some pair of possible kinds is accepted by `accepts`. */
export function somePair(
  left: readonly ValueKind[],
  right: readonly ValueKind[],
  accepts: (a: ValueKind, b: ValueKind) => boolean,
): boolean {
  return left.some((a) => right.some((b) => accepts(a, b)));
}
