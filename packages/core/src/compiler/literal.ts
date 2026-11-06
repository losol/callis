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
const MIN_INTEGER = -(2n ** 31n);
const MAX_INTEGER = 2n ** 31n - 1n;

/**
 * The value of a constant expression.
 *
 * - `integer`: an Integer literal, kept as a `bigint` until it is used, so that `-2147483648` is
 *   valid although `2147483648` alone is not.
 * - `decimal`, `quantity`: values that the polarity operators can fold.
 * - `other`: any other literal, as its collection.
 * - `invalid`: a literal whose value is not allowed, with the span of that literal.
 */
export type Constant =
  | { readonly kind: 'integer'; readonly value: bigint; readonly span: NodeSpan }
  | { readonly kind: 'decimal'; readonly value: Decimal }
  | { readonly kind: 'quantity'; readonly value: Quantity }
  | { readonly kind: 'other'; readonly items: Collection }
  | { readonly kind: 'invalid'; readonly message: string; readonly span: NodeSpan };

/**
 * The constant value of a literal, or of `+` or `-` applied to a number or quantity constant.
 * Undefined when the expression is not such a constant; `-'a'` is not folded, so that it raises
 * its type error when evaluated.
 */
export function constantOf(node: ExpressionNode): Constant | undefined {
  if (node.kind === 'Literal') {
    return literalConstant(node);
  }
  if (node.kind !== 'Unary') {
    return undefined;
  }
  const operand = constantOf(node.operand);
  if (operand === undefined || node.op === '+') {
    return operand?.kind === 'other' ? undefined : operand;
  }
  switch (operand.kind) {
    case 'integer':
      return { kind: 'integer', value: -operand.value, span: node.span };
    case 'decimal':
      return { kind: 'decimal', value: negateDecimal(operand.value) };
    case 'quantity':
      return {
        kind: 'quantity',
        value: new Quantity(negateDecimal(operand.value.value), operand.value.unit),
      };
    case 'other':
      return undefined;
    case 'invalid':
      return operand;
    default:
      return assertNever(operand, 'constant');
  }
}

/**
 * The collection of a constant, or the message of the `eval/invalid-literal` error it raises.
 */
export function materialize(
  constant: Constant,
): { readonly items: Collection } | { readonly invalid: string; readonly span: NodeSpan } {
  switch (constant.kind) {
    case 'integer':
      return constant.value >= MIN_INTEGER && constant.value <= MAX_INTEGER
        ? { items: Object.freeze([Number(constant.value)]) }
        : {
            invalid: `The Integer ${constant.value} is outside the 32-bit range of System.Integer`,
            span: constant.span,
          };
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
      return { kind: 'integer', value: BigInt(node.raw), span: node.span };
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
