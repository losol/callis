/**
 * The compiler: turns an AST into a tree of closures, once
 * ([ADR-0003](https://github.com/losol/callis/blob/main/docs/adr/0003-closure-compilation.md),
 * [T0008: compiling to closures](https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#compiling-to-closures)).
 *
 * Everything static is decided here: function lookup and arity, operator choice, literal values,
 * type specifiers and constant folding. Evaluating an expression means calling the root closure.
 * Closures return promises only in async mode, through the `MaybePromise` helpers
 * ([ADR-0004](https://github.com/losol/callis/blob/main/docs/adr/0004-sync-core-async-path.md)).
 */
import { assertNever } from '../errors/assert-never.ts';
import { FhirPathEvaluationError, FhirPathSemanticError } from '../errors/fhirpath-error.ts';
import type { SourceSpan } from '../errors/source-span.ts';
import { paramAt } from '../functions/define.ts';
import type { FunctionRegistry } from '../functions/registry.ts';
import { LineTable } from '../lexer/line-table.ts';
import type { ModelProvider } from '../model/model-provider.ts';
import type {
  AstNode,
  BinaryNode,
  ExpressionNode,
  FunctionCallNode,
  IndexerNode,
  TypeOperationNode,
  UnaryNode,
} from '../parser/ast.ts';
import { type Collection, EMPTY, fromBoolean, type Item } from '../runtime/collection.ts';
import type { EvalContext, Evaluator, Frame } from '../runtime/context.ts';
import { asBoolean, asInteger } from '../runtime/item-conversion.ts';
import { and, implies, or, type TruthValue, xor } from '../runtime/logic.ts';
import { adoptResult, andThen, isThenable } from '../runtime/maybe-promise.ts';
import { navigateMember, navigateRoot } from '../runtime/navigation.ts';
import { toSystemValue } from '../runtime/node-value.ts';
import { BINARY_OPERATIONS, type BinaryOperation } from '../runtime/operators.ts';
import { singleton } from '../runtime/singleton.ts';
import { asType, isType, resolveTypeTarget } from '../runtime/type-target.ts';
import { lookUpVariable } from '../runtime/variables.ts';
import { type TypeSpecifier, typeSpecifierFromIdentifiers } from '../types/type-specifier.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { Quantity } from '../values/quantity/quantity.ts';
import { type CompiledArg, evaluateArgs } from './lambda.ts';
import {
  applyIntegerPolarity,
  type Constant,
  constantOf,
  literalConstant,
  materialize,
  negateDecimal,
} from './literal.ts';
import { checkNesting } from './nesting.ts';

/** What the compiler needs besides the AST. */
export interface CompileContext {
  /** The functions calls are resolved against. */
  readonly registry: FunctionRegistry;
  /** The model type specifiers are resolved against, if any. */
  readonly model: ModelProvider | undefined;
  /** The expression text, for error spans and messages. */
  readonly expression: string;
}

/**
 * Compiles an expression to its root closure.
 *
 * @throws {@link FhirPathSemanticError} for an unknown function (`semantic/unknown-function`), a
 *   wrong number of arguments (`semantic/wrong-arity`) or a type argument that is not a type name
 *   (`semantic/invalid-argument`). Unknown types and invalid literal values are not compile errors;
 *   they raise when evaluated.
 * @throws {@link FhirPathSyntaxError} `syntax/nesting-limit` for a tree deeper than the limit,
 *   such as a chain of thousands of member invocations.
 */
export function compileExpression(node: ExpressionNode, context: CompileContext): Evaluator {
  checkNesting(node, context.expression);
  return compileNode(node, { ...context, lines: new LineTable(context.expression) });
}

interface CompilerState extends CompileContext {
  readonly lines: LineTable;
}

function compileNode(node: ExpressionNode, cc: CompilerState): Evaluator {
  switch (node.kind) {
    case 'Literal':
      return compileConstant(literalConstant(node), cc);
    case 'Identifier': {
      const name = node.name;
      return (ctx, focus) => navigateRoot(focus, name, ctx);
    }
    case 'Member': {
      const target = compileNode(node.target, cc);
      const name = node.name;
      return (ctx, focus, frame) =>
        andThen(target(ctx, focus, frame), (input) => navigateMember(input, name, ctx));
    }
    case 'FunctionCall':
      return compileFunctionCall(node, cc);
    case 'Indexer':
      return compileIndexer(node, cc);
    case 'Unary':
      return compileUnary(node, cc);
    case 'Binary':
      return compileBinary(node, cc);
    case 'TypeOperation':
      return compileTypeOperation(node, cc);
    case 'Variable': {
      const name = node.name;
      const span = spanOf(node, cc);
      const expression = cc.expression;
      return (ctx) => {
        const value = lookUpVariable(ctx, name);
        if (value === undefined) {
          // N1 §9: "an error" for an undefined variable.
          throw new FhirPathEvaluationError(
            'eval/undefined-variable',
            `The variable %${name} is not defined`,
            { span, expression },
          );
        }
        return value;
      };
    }
    case 'This':
      return compileFrameVariable(node.target, cc, (frame) => frame.this);
    case 'Index':
      return compileFrameVariable(node.target, cc, (frame) =>
        frame.index === undefined ? EMPTY : [frame.index],
      );
    case 'Total':
      return compileFrameVariable(node.target, cc, (frame) => frame.total ?? EMPTY);
    default:
      return assertNever(node, 'expression node');
  }
}

/**
 * Literals, and `+`/`-` on number and quantity literals, become constants. An invalid literal
 * value raises `eval/invalid-literal` when it is evaluated, not now.
 */
function compileConstant(constant: Constant, cc: CompilerState): Evaluator {
  const result = materialize(constant);
  if ('items' in result) {
    const items = result.items;
    return () => items;
  }
  const error = {
    message: result.invalid,
    span: cc.lines.span(result.span.start, result.span.end),
    expression: cc.expression,
  };
  return () => {
    throw new FhirPathEvaluationError('eval/invalid-literal', error.message, error);
  };
}

/**
 * `$this`, `$index` and `$total`. The grammar also allows them after a dot (`name.$this`); the
 * target is then evaluated, so its errors surface, and the variable is the result
 * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#frame-variables-after-a-dot)).
 */
function compileFrameVariable(
  targetNode: ExpressionNode | null,
  cc: CompilerState,
  read: (frame: Frame) => Collection,
): Evaluator {
  if (targetNode === null) {
    return (_ctx, _focus, frame) => read(frame);
  }
  const target = compileNode(targetNode, cc);
  return (ctx, focus, frame) => andThen(target(ctx, focus, frame), () => read(frame));
}

function compileFunctionCall(node: FunctionCallNode, cc: CompilerState): Evaluator {
  const span = spanOf(node, cc);
  const expression = cc.expression;
  const definition = cc.registry.resolve(node.name, node.args.length, { span, expression });
  const target = node.target === null ? undefined : compileNode(node.target, cc);
  const args: CompiledArg[] = node.args.map((arg, index) => {
    // The registry checked the arity, so every argument has a parameter.
    const kind = paramAt(definition, index)?.kind ?? 'value';
    switch (kind) {
      case 'value':
        return { kind, evaluate: compileNode(arg, cc) };
      case 'lambda':
        return { kind, evaluate: compileNode(arg, cc) };
      case 'type':
        return {
          kind,
          arg: { kind, target: resolveTypeTarget(typeArgument(arg, node, cc), cc.model) },
        };
      default:
        return assertNever(kind, 'parameter kind');
    }
  });
  const name = node.name;
  const impl = definition.impl;
  return located(span, expression, (ctx, focus, frame) =>
    andThen(target === undefined ? focus : target(ctx, focus, frame), (input) =>
      andThen(evaluateArgs(args, ctx, focus, frame), (values) =>
        // A function added with registry.extend() is a host boundary: a thenable result is
        // rejected in sync mode and adopted as a native promise in async mode.
        adoptResult(impl({ ctx, frame, name, span }, input, values), ctx.isAsync),
      ),
    ),
  );
}

/** The type name written as a function argument, as in `ofType(FHIR.Patient)`. */
function typeArgument(
  arg: ExpressionNode,
  call: FunctionCallNode,
  cc: CompilerState,
): TypeSpecifier {
  const rest: string[] = [];
  let current = arg;
  while (current.kind === 'Member') {
    rest.unshift(current.name);
    current = current.target;
  }
  if (current.kind !== 'Identifier') {
    throw new FhirPathSemanticError(
      'semantic/invalid-argument',
      `Expected a type name as the argument of ${call.name}()`,
      { span: spanOf(arg, cc), expression: cc.expression },
    );
  }
  return typeSpecifierFromIdentifiers([current.name, ...rest]);
}

/**
 * `target[index]` ([N1 §6.7.1](https://hl7.org/fhirpath/N1/#index-integer-collection)): the
 * item at the zero-based position, or empty when the index is outside the collection. The index
 * is a single Integer, evaluated with the same focus as the target.
 */
function compileIndexer(node: IndexerNode, cc: CompilerState): Evaluator {
  const target = compileNode(node.target, cc);
  const index = compileNode(node.index, cc);
  return located(spanOf(node, cc), cc.expression, (ctx, focus, frame) =>
    andThen(target(ctx, focus, frame), (items) =>
      andThen(index(ctx, focus, frame), (positions) => {
        const position = singleton(positions, 'Integer', asInteger);
        const item = position === undefined || position < 0 ? undefined : items[position];
        return item === undefined ? EMPTY : [item];
      }),
    ),
  );
}

/**
 * The polarity operators `+` and `-` ([N1 §6.6](https://hl7.org/fhirpath/N1/#math)). On a
 * number or quantity literal they are folded at compile time.
 */
function compileUnary(node: UnaryNode, cc: CompilerState): Evaluator {
  const constant = constantOf(node);
  if (constant !== undefined) {
    return compileConstant(constant, cc);
  }
  const operand = compileNode(node.operand, cc);
  const negate = node.op === '-';
  return located(spanOf(node, cc), cc.expression, (ctx, focus, frame) =>
    andThen(operand(ctx, focus, frame), (items) => applyPolarity(items, negate)),
  );
}

/**
 * `+x` or `-x` for a single Integer, Decimal or Quantity; empty for empty input. An Integer that
 * overflows the 32-bit range (`-(-2147483648)`) is empty, as other Integer overflows are
 * ([3.0.0 math](https://hl7.org/fhirpath/STU3/#math-1)).
 */
function applyPolarity(items: Collection, negate: boolean): Collection {
  const item = singleton(items, 'Any', identity);
  const value = item === undefined ? undefined : toSystemValue(item);
  if (value === undefined) {
    return EMPTY;
  }
  if (typeof value === 'number') {
    const result = applyIntegerPolarity(value, negate);
    return result === undefined ? EMPTY : [result];
  }
  if (value instanceof Decimal) {
    return [negate ? negateDecimal(value) : value];
  }
  if (value instanceof Quantity) {
    return [negate ? new Quantity(negateDecimal(value.value), value.unit) : value];
  }
  throw new FhirPathEvaluationError(
    'eval/type-mismatch',
    `Expected an Integer, Decimal or Quantity for unary ${negate ? '-' : '+'}`,
  );
}

function identity(item: Item): Item {
  return item;
}

const LOGIC: Readonly<
  Record<'and' | 'or' | 'xor' | 'implies', (a: TruthValue, b: TruthValue) => TruthValue>
> = Object.freeze({ and, or, xor, implies });

function compileBinary(node: BinaryNode, cc: CompilerState): Evaluator {
  switch (node.op) {
    case 'and':
    case 'or':
    case 'xor':
    case 'implies':
      return compileLogic(node, LOGIC[node.op], cc);
    case '*':
    case '/':
    case 'div':
    case 'mod':
    case '+':
    case '-':
    case '&':
    case '|':
    case '<':
    case '>':
    case '<=':
    case '>=':
    case '=':
    case '~':
    case '!=':
    case '!~':
    case 'in':
    case 'contains':
      return compileOperation(node, BINARY_OPERATIONS[node.op], cc);
    default:
      return assertNever(node.op, 'operator');
  }
}

/**
 * `and`, `or`, `xor` and `implies` ([N1 §6.5](https://hl7.org/fhirpath/N1/#boolean-logic)). Both
 * operands are always evaluated, left first, so an error on the right surfaces even when the left
 * operand decides the result. Each operand is a Boolean by singleton evaluation.
 */
function compileLogic(
  node: BinaryNode,
  combine: (a: TruthValue, b: TruthValue) => TruthValue,
  cc: CompilerState,
): Evaluator {
  const left = compileNode(node.left, cc);
  const right = compileNode(node.right, cc);
  return located(spanOf(node, cc), cc.expression, (ctx, focus, frame) =>
    andThen(left(ctx, focus, frame), (leftItems) => {
      const a = singleton(leftItems, 'Boolean', asBoolean);
      return andThen(right(ctx, focus, frame), (rightItems) =>
        fromBoolean(combine(a, singleton(rightItems, 'Boolean', asBoolean))),
      );
    }),
  );
}

/** Compiles both operands once and evaluates them left to right, also in async mode. */
function compileOperation(
  node: BinaryNode,
  operation: BinaryOperation,
  cc: CompilerState,
): Evaluator {
  const left = compileNode(node.left, cc);
  const right = compileNode(node.right, cc);
  return located(spanOf(node, cc), cc.expression, (ctx, focus, frame) =>
    andThen(left(ctx, focus, frame), (a) =>
      andThen(right(ctx, focus, frame), (b) => operation(a, b, ctx)),
    ),
  );
}

/**
 * `is` and `as` ([N1 §6.3](https://hl7.org/fhirpath/N1/#types)). The type is resolved now; an
 * unknown type raises `eval/unknown-type` when the operator is evaluated.
 */
function compileTypeOperation(node: TypeOperationNode, cc: CompilerState): Evaluator {
  const operand = compileNode(node.operand, cc);
  const [first, ...rest] = node.type.identifiers;
  if (first === undefined) {
    // The parser never produces this; only a hand-made AST can.
    throw new FhirPathSemanticError(
      'semantic/invalid-argument',
      `Expected a type name after ${node.op}`,
      {
        span: spanOf(node.type, cc),
        expression: cc.expression,
      },
    );
  }
  const target = resolveTypeTarget(typeSpecifierFromIdentifiers([first, ...rest]), cc.model);
  const span = spanOf(node, cc);
  if (node.op === 'is') {
    return located(span, cc.expression, (ctx, focus, frame) =>
      andThen(operand(ctx, focus, frame), (items) => fromBoolean(isType(items, target, ctx))),
    );
  }
  return located(span, cc.expression, (ctx, focus, frame) =>
    andThen(operand(ctx, focus, frame), (items) => asType(items, target, ctx)),
  );
}

function spanOf(node: AstNode, cc: CompilerState): SourceSpan {
  return cc.lines.span(node.span.start, node.span.end);
}

/**
 * Attaches the span of an operator or function call to evaluation errors raised inside it that
 * do not have a span yet. Spans are attached at these boundaries only, to keep the hot path cheap.
 */
function located(span: SourceSpan, expression: string, evaluator: Evaluator): Evaluator {
  const locate = (error: unknown): never => {
    throw withSpan(error, span, expression);
  };
  return (ctx: EvalContext, focus: Collection, frame: Frame) => {
    let result: ReturnType<Evaluator>;
    try {
      result = evaluator(ctx, focus, frame);
    } catch (error) {
      return locate(error);
    }
    return isThenable(result) ? Promise.resolve(result).then(undefined, locate) : result;
  };
}

function withSpan(error: unknown, span: SourceSpan, expression: string): unknown {
  if (error instanceof FhirPathEvaluationError && error.span === undefined) {
    return new FhirPathEvaluationError(error.code, error.message, {
      span,
      expression,
      cause: error,
    });
  }
  return error;
}
