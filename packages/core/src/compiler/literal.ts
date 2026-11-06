/**
 * Literal values, built once at compile time, and constant folding of the polarity operators on
 * number and quantity literals (`-1`, `-2147483648`, `-5.5 'mg'`).
 *
 * A well-formed literal whose value is not allowed (`@2015-02-30`, `@T14:34:28Z`, a Decimal beyond
 * the size bound, an Integer outside the 32-bit range) is not a compile error. It becomes an
 * `invalid` constant, which the compiler turns into a closure that raises `eval/invalid-literal`
 * when it is evaluated ([T0008: invalid literal values](https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#invalid-literal-values)).
 */
import { assertNever } from '../errors/assert-never.ts';
import type { ExpressionNode, LiteralNode, NodeSpan } from '../parser/ast.ts';
import { type Collection, EMPTY } from '../runtime/collection.ts';
import { parseTemporalLiteral } from '../values/datetime/parse.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { Quantity } from '../values/quantity/quantity.ts';

/** The 32-bit range of `System.Integer` ([N1 §4.1](https://hl7.org/fhirpath/N1/#literals)). */
const MIN_INTEGER = -(2 ** 31);
const MAX_INTEGER = 2 ** 31 - 1;

/**
 * The value of a constant expression.
 *
 * - `integer literal`: the digits of an Integer literal, as a `bigint`. Only `+` or `-` written
 *   directly before it may bring it into range, so that `-2147483648` is valid although
 *   `2147483648` alone is not.
 * - `integer`: an Integer value. Further polarity operators follow the ordinary Integer rules, so
 *   an overflow is empty, as at runtime.
 * - `decimal`, `quantity`: values that the polarity operators can fold.
 * - `other`: any other literal, and an Integer overflow, as its collection.
 * - `invalid`: a literal whose value is not allowed, with the span of that literal.
 */
export type Constant =
  | { readonly kind: 'integer literal'; readonly digits: bigint; readonly span: NodeSpan }
  | { readonly kind: 'integer'; readonly value: number }
  | { readonly kind: 'decimal'; readonly value: Decimal }
  | { readonly kind: 'quantity'; readonly value: Quantity }
  | { readonly kind: 'other'; readonly items: Collection }
  | { readonly kind: 'invalid'; readonly message: string; readonly span: NodeSpan };

/**
 * The constant value of a literal, or of `+` or `-` applied to a number or quantity constant.
 * Undefined when the expression is not such a constant; `-'a'` is not folded, so that it raises
 * its type error when evaluated.
 *
 * Folding gives the same result as evaluating: `-(-2147483648)` overflows to empty exactly as
 * `-%i` does with `%i` the smallest Integer.
 */
export function constantOf(node: ExpressionNode): Constant | undefined {
  if (node.kind === 'Literal') {
    return literalConstant(node);
  }
  if (node.kind !== 'Unary') {
    return undefined;
  }
  const operand = constantOf(node.operand);
  if (operand === undefined) {
    return undefined;
  }
  const negate = node.op === '-';
  switch (operand.kind) {
    case 'integer literal': {
      // The sign written before the literal is part of its value.
      const value = negate ? -operand.digits : operand.digits;
      return value >= BigInt(MIN_INTEGER) && value <= BigInt(MAX_INTEGER)
        ? { kind: 'integer', value: Number(value) }
        : outOfRange(value, node.span);
    }
    case 'integer': {
      const value = applyIntegerPolarity(operand.value, negate);
      return value === undefined ? { kind: 'other', items: EMPTY } : { kind: 'integer', value };
    }
    case 'decimal':
      return negate ? { kind: 'decimal', value: negateDecimal(operand.value) } : operand;
    case 'quantity':
      return negate
        ? {
            kind: 'quantity',
            value: new Quantity(negateDecimal(operand.value.value), operand.value.unit),
          }
        : operand;
    case 'other':
      // `-'a'` raises a type error and `-{}` is empty; both are left to evaluation.
      return undefined;
    case 'invalid':
      return operand;
    default:
      return assertNever(operand, 'constant');
  }
}

/**
 * `+value` or `-value` for an Integer, or undefined when the result overflows the 32-bit range
 * (`-(-2147483648)`), which makes it empty as other Integer overflows are
 * ([3.0.0 math](https://hl7.org/fhirpath/STU3/#math-1)). The compiler uses it for folding and at
 * runtime, so both agree.
 *
 * @see https://hl7.org/fhirpath/N1/#math
 */
export function applyIntegerPolarity(value: number, negate: boolean): number | undefined {
  // `0 - 0` is `0`, so negating zero does not give a negative zero.
  const result = negate ? 0 - value : value;
  return result >= MIN_INTEGER && result <= MAX_INTEGER ? result : undefined;
}

/**
 * The collection of a constant, or the message of the `eval/invalid-literal` error it raises.
 */
export function materialize(
  constant: Constant,
): { readonly items: Collection } | { readonly invalid: string; readonly span: NodeSpan } {
  switch (constant.kind) {
    case 'integer literal': {
      // A bare literal, with no sign before it.
      const { digits, span } = constant;
      return digits <= BigInt(MAX_INTEGER)
        ? { items: Object.freeze([Number(digits)]) }
        : { invalid: outOfRangeMessage(digits), span };
    }
    case 'integer':
    case 'decimal':
    case 'quantity':
      return { items: Object.freeze([constant.value]) };
    case 'other':
      return { items: constant.items };
    case 'invalid':
      return { invalid: constant.message, span: constant.span };
    default:
      return assertNever(constant, 'constant');
  }
}

function outOfRange(value: bigint, span: NodeSpan): Constant {
  return { kind: 'invalid', message: outOfRangeMessage(value), span };
}

function outOfRangeMessage(value: bigint): string {
  return `The Integer ${value} is outside the 32-bit range of System.Integer`;
}

/**
 * The negated value of a Decimal. Negation keeps the digits, so it stays within the size bound.
 *
 * @see https://hl7.org/fhirpath/N1/#polarity
 */
export function negateDecimal(value: Decimal): Decimal {
  return Decimal.of(-value.coefficient, value.scale);
}

/** The constant value of a literal. */
export function literalConstant(node: LiteralNode): Constant {
  switch (node.type) {
    case 'Empty':
      return { kind: 'other', items: EMPTY };
    case 'Boolean':
      return { kind: 'other', items: Object.freeze([node.raw === 'true']) };
    case 'String':
      return { kind: 'other', items: Object.freeze([node.value ?? '']) };
    case 'Integer':
      return { kind: 'integer literal', digits: BigInt(node.raw), span: node.span };
    case 'Decimal': {
      const value = Decimal.parse(node.raw);
      return value === undefined
        ? invalid(node, 'The Decimal literal exceeds the Decimal size bound')
        : { kind: 'decimal', value };
    }
    case 'Quantity': {
      const value = node.number === undefined ? undefined : Decimal.parse(node.number);
      return value === undefined
        ? invalid(node, 'The quantity value exceeds the Decimal size bound')
        : { kind: 'quantity', value: new Quantity(value, node.unit) };
    }
    case 'Date':
    case 'DateTime':
    case 'Time': {
      const value = parseTemporalLiteral(node.raw);
      return value === undefined
        ? invalid(node, `The literal ${node.raw} is not a valid ${node.type}`)
        : { kind: 'other', items: Object.freeze([value]) };
    }
    default:
      return assertNever(node.type, 'literal type');
  }
}

function invalid(node: LiteralNode, message: string): Constant {
  return { kind: 'invalid', message, span: node.span };
}
