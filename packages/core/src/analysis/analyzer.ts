/**
 * Static analysis: type and cardinality inference over the AST, and the diagnostics it yields
 * ([T0024](https://github.com/losol/callis/blob/main/docs/tasks/T0024-static-analysis.md)).
 *
 * The analyzer walks the tree once, with the registry, the model and the input type that the
 * compile options give, and infers what each node evaluates to ({@link Inferred}). It never
 * changes the AST and never evaluates anything. It reports:
 *
 * - always: an unknown function, a wrong number of arguments, a type argument that is not a type
 *   name, `$total` outside `aggregate()`, and an input or argument whose every possible type a
 *   function rejects (`'a'.abs()`, `toString()` on a complex value);
 * - as a warning, an operator whose operands it never accepts (`1 + 'a'`), which raises
 *   `eval/type-mismatch` when evaluated: the HL7 test suite expects an execution error there and
 *   a semantic error for a function, as the HL7 Java engine gives
 *   ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#function-types-are-checked-statically-operator-types-when-evaluated));
 * - with a model: an element the type does not have (with a hint for a choice element written
 *   with its type suffix), a leading type name that does not match the input, and the types of
 *   `is`, `as` and `ofType()` that do not resolve, as warnings
 *   ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#unresolved-type-specifiers-are-execution-errors));
 * - in strict mode ([N1 §11](https://hl7.org/fhirpath/N1/#type-safety-and-strict-evaluation)):
 *   the operator warnings as errors, a value that may repeat where one item is expected, a value
 *   that is not a Boolean where one is expected, equality between a single item and a collection
 *   or between types that are never equal, and an order-dependent operation on `children()` or
 *   `descendants()` ([N1 §3.1](https://hl7.org/fhirpath/N1/#collections));
 * - a warning when date/time arithmetic ignores part of a quantity written in the expression
 *   ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#fractions-in-datetime-arithmetic)).
 *
 * Every check fires only when every possible type is wrong, and never on a value whose type is
 * unknown, so analysis without a model never rejects a valid expression.
 */
import { assertNever } from '../errors/assert-never.ts';
import type { Diagnostic } from '../errors/diagnostic.ts';
import type { SemanticErrorCode } from '../errors/error-codes.ts';
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { combineFunction, unionFunction } from '../functions/combining.ts';
import { iifFunction } from '../functions/conversion.ts';
import {
  arityOf,
  type FunctionDefinition,
  type ParamSpec,
  paramAt,
  type TypeExpectation,
} from '../functions/define.ts';
import { ofTypeFunction, repeatFunction, selectFunction } from '../functions/filtering.ts';
import { notFunction } from '../functions/logic.ts';
import { describeArity, type FunctionRegistry } from '../functions/registry.ts';
import { asFunction, isFunction } from '../functions/types.ts';
import { LineTable } from '../lexer/line-table.ts';
import type { ModelProvider, ModelTypeInfo } from '../model/model-provider.ts';
import type {
  AstNode,
  BinaryNode,
  ExpressionNode,
  FunctionCallNode,
  IndexerNode,
  LiteralNode,
  TypeOperationNode,
  UnaryNode,
} from '../parser/ast.ts';
import { findChoiceBySuffix } from '../runtime/navigation.ts';
import { resolveTypeTarget, type TypeTarget } from '../runtime/type-target.ts';
import { isSystemType, SYSTEM_TYPES } from '../types/system-types.ts';
import { type TypeSpecifier, typeSpecifierFromIdentifiers } from '../types/type-specifier.ts';
import { isOfType } from '../types/type-test.ts';
import { isFractionIgnored } from '../values/datetime/arithmetic.ts';
import { parseTemporalLiteral } from '../values/datetime/parse.ts';
import type { Precision } from '../values/datetime/precision.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { type CalendarUnit, timeUnitMagnitude } from '../values/quantity/calendar-units.ts';
import {
  type AnalysisType,
  type Cardinality,
  describeExpectation,
  describeTypes,
  hasKnownTypes,
  type Inferred,
  isNothing,
  type NarrowingRule,
  NOTHING,
  narrowTo,
  singleOf,
  someFits,
  type TypeSet,
  typeSetOf,
  UNKNOWN,
  unionTypes,
  withArticle,
} from './inferred-type.ts';
import {
  type ArithmeticOperator,
  arithmeticResult,
  isComparable,
  isTemporalKind,
  kindsOf,
  somePair,
  VALUE_KINDS,
  type ValueKind,
} from './operators.ts';
import {
  bothGuards,
  eitherGuard,
  type Guard,
  lambdaScope,
  NO_GUARD,
  narrowByKey,
  negateGuard,
  pathKey,
  rootScope,
  type Scope,
  withConstraints,
} from './scope.ts';

/** What the analyzer needs besides the AST. */
export interface AnalysisOptions {
  /** The expression text, for the spans of the diagnostics. */
  readonly expression: string;
  /** The functions calls are resolved against. */
  readonly registry: FunctionRegistry;
  /** The model, if any. Without one, only System types are known. */
  readonly model: ModelProvider | undefined;
  /**
   * The type of the input, by name in the model namespace, or the types it may have. Undefined
   * when it is unknown; an empty list means the same.
   */
  readonly inputType: string | readonly string[] | undefined;
  /** Whether to report the unsafe uses of N1 §11 as errors. */
  readonly strict: boolean;
  /** Whether a choice element may be written with its type suffix (`lenient.choiceSuffix`). */
  readonly lenientChoiceSuffix: boolean;
}

/** What analysis found. */
export interface AnalysisOutcome {
  /** The problems, in source order; those about the options first. */
  readonly diagnostics: readonly Diagnostic[];
  /** What the expression evaluates to. */
  readonly result: Inferred;
}

/** Analyzes a parsed expression. The caller has checked the nesting depth of a hand-made tree. */
export function analyzeExpression(node: ExpressionNode, options: AnalysisOptions): AnalysisOutcome {
  const diagnostics = new DiagnosticList(options.expression);
  const input = resolveInputType(options, diagnostics);
  const analyzer = new Analyzer(options, input, diagnostics);
  const result = analyzer.infer(node, rootScope(input));
  return { diagnostics: diagnostics.sorted(), result };
}

/** The input as the options describe it: its type or types, one item. */
function resolveInputType(options: AnalysisOptions, diagnostics: DiagnosticList): Inferred {
  const { inputType, model } = options;
  const names = inputType === undefined || typeof inputType === 'string' ? [inputType] : inputType;
  const types: ModelTypeInfo[] = [];
  let unknown = false;
  for (const name of names) {
    if (name === undefined) {
      return UNKNOWN;
    }
    const type = model?.getType(name);
    if (type === undefined) {
      diagnostics.add(
        'error',
        'semantic/unknown-type',
        `The input type ${name} is not defined in the model`,
      );
      unknown = true;
    } else {
      types.push(type);
    }
  }
  if (types.length === 0) {
    return UNKNOWN;
  }
  return { types: unknown ? undefined : typeSetOf(types), cardinality: 'single', ordered: true };
}

/** The diagnostics of one analysis, with their spans. */
class DiagnosticList {
  readonly #lines: LineTable;
  readonly #items: Diagnostic[] = [];

  constructor(expression: string) {
    this.#lines = new LineTable(expression);
  }

  add(
    severity: Diagnostic['severity'],
    code: SemanticErrorCode,
    message: string,
    node?: AstNode,
    hint?: string,
  ): void {
    this.#items.push({
      severity,
      code,
      message,
      ...(node === undefined ? {} : { span: this.#lines.span(node.span.start, node.span.end) }),
      ...(hint === undefined ? {} : { hint }),
    });
  }

  /** In source order; a diagnostic without a span, about the options, comes first. */
  sorted(): readonly Diagnostic[] {
    return [...this.#items].sort((a, b) => (a.span?.start ?? -1) - (b.span?.start ?? -1));
  }
}

/** A single Boolean, as the logical operators and the criteria of `where()` take it. */
const BOOLEAN: TypeExpectation = { type: 'Boolean', singleton: true };
/** The index of the indexer. */
const INDEX: TypeExpectation = { type: 'Integer', singleton: true };
/** The operand of the polarity operators. */
const POLARITY: TypeExpectation = { type: ['Decimal', 'Quantity'], singleton: true };
/**
 * The most passes over a `repeat()` projection to find the types its focus may have. Each pass
 * adds a type or ends the walk, so a model's types bound it; a walk still going is unknown.
 */
const MAX_REPEAT_STEPS = 32;

class Analyzer {
  readonly #registry: FunctionRegistry;
  readonly #model: ModelProvider | undefined;
  readonly #strict: boolean;
  readonly #lenientChoiceSuffix: boolean;
  readonly #input: Inferred;
  readonly #diagnostics: DiagnosticList;
  readonly #options: AnalysisOptions;

  constructor(options: AnalysisOptions, input: Inferred, diagnostics: DiagnosticList) {
    this.#options = options;
    this.#registry = options.registry;
    this.#model = options.model;
    this.#strict = options.strict;
    this.#lenientChoiceSuffix = options.lenientChoiceSuffix;
    this.#input = input;
    this.#diagnostics = diagnostics;
  }

  /**
   * What a node evaluates to in a scope, after the type guards in force on its path. A value
   * that can have no item, because a guard, `as` or `ofType()` ruled every type out, is
   * {@link NOTHING} whatever was inferred about its cardinality.
   */
  infer(node: ExpressionNode, scope: Scope): Inferred {
    const inferred = this.#inferNode(node, scope);
    const key = pathKey(node);
    return nothingOr(key === undefined ? inferred : narrowByKey(scope, key, inferred, this.#model));
  }

  #report(
    severity: Diagnostic['severity'],
    code: SemanticErrorCode,
    message: string,
    node: AstNode,
    hint?: string,
  ): void {
    this.#diagnostics.add(severity, code, message, node, hint);
  }

  /** The focus of a scope, after the guards on `$this`. */
  #focusOf(scope: Scope): Inferred {
    return nothingOr(narrowByKey(scope, '$this', scope.focus, this.#model));
  }

  #inferNode(node: ExpressionNode, scope: Scope): Inferred {
    switch (node.kind) {
      case 'Literal':
        return inferLiteral(node);
      case 'Identifier':
        return this.#inferIdentifier(node.name, scope, node);
      case 'Member':
        return this.#navigate(this.infer(node.target, scope), node.name, node);
      case 'FunctionCall':
        return this.#inferCall(node, scope);
      case 'Indexer':
        return this.#inferIndexer(node, scope);
      case 'Unary':
        return this.#inferUnary(node, scope);
      case 'Binary':
        return this.#inferBinary(node, scope);
      case 'TypeOperation':
        return this.#inferTypeOperation(node, scope);
      case 'Variable':
        // %context is the input; the other variables are only known when they are evaluated.
        return node.name === 'context' ? this.#input : UNKNOWN;
      case 'This':
        // `name.$this` evaluates `name` for its errors and is then `$this` (spec notes).
        if (node.target !== null) {
          this.infer(node.target, scope);
        }
        return this.#focusOf(scope);
      case 'Index':
        if (node.target !== null) {
          this.infer(node.target, scope);
        }
        return singleOf('Integer');
      case 'Total':
        if (node.target !== null) {
          this.infer(node.target, scope);
        }
        // N1 §7: $total is the accumulator of aggregate(), which is phase 2 (T0026).
        this.#report(
          'error',
          'semantic/undefined-variable',
          '$total is only defined inside aggregate()',
          node,
        );
        return UNKNOWN;
      default:
        return assertNever(node, 'expression node');
    }
  }

  /**
   * An identifier at the start of a path. With a model, a resource, complex or backbone type
   * name selects the focus items of that type ([T0018: navigation rules](https://github.com/losol/callis/blob/main/docs/tasks/T0018-model-aware-evaluation.md#navigation-rules));
   * a primitive type name and any other name are element names.
   */
  #inferIdentifier(name: string, scope: Scope, node: AstNode): Inferred {
    const focus = this.#focusOf(scope);
    const model = this.#model;
    if (model !== undefined) {
      const type = model.getType(name);
      if (type !== undefined && type.kind !== 'primitive') {
        return this.#selectType(focus, type, node);
      }
    }
    return this.#navigate(focus, name, node);
  }

  /** The focus items of a type: those whose type is the type or one of its subtypes. */
  #selectType(focus: Inferred, type: ModelTypeInfo, node: AstNode): Inferred {
    if (focus.types === undefined) {
      return { types: [type], cardinality: focus.cardinality, ordered: focus.ordered };
    }
    const model = this.#model;
    const matches: AnalysisType[] = [];
    for (const candidate of focus.types) {
      if (isOfType(candidate, type, model)) {
        matches.push(candidate);
      } else if (isOfType(type, candidate, model)) {
        // An abstract type such as Resource: the item may be of the named subtype.
        matches.push(type);
      }
    }
    if (matches.length === 0 && focus.types.length > 0) {
      this.#report(
        'error',
        'semantic/type-mismatch',
        `${type.name} does not match the input, which is ${withArticle(describeTypes(focus.types))}`,
        node,
      );
    }
    return { types: typeSetOf(matches), cardinality: focus.cardinality, ordered: focus.ordered };
  }

  /**
   * The element `name` of the input: with a model, what `ModelProvider.getElement()` says for
   * each possible type, as `navigateMember()` does at runtime. An element that no possible type
   * has is an error, unless a type is abstract, whose subtypes may have it, or the types are
   * unknown. A System value has no elements. Without a model, a name such as `Quantity` resolves
   * to the System type although the expression may be written for a model, where it is a complex
   * type with elements, so nothing is known about the elements there (`testPolymorphismAsA`).
   */
  #navigate(input: Inferred, name: string, node: AstNode): Inferred {
    const model = this.#model;
    if (input.types === undefined || model === undefined) {
      return { types: undefined, cardinality: 'unknown', ordered: input.ordered };
    }
    const found: (AnalysisType | undefined)[] = [];
    const missing: AnalysisType[] = [];
    let unknown = false;
    let repeats = false;
    for (const type of input.types) {
      if (isSystemType(type)) {
        missing.push(type);
        continue;
      }
      const element = model.getElement(type, name);
      if (element !== undefined) {
        for (const typeName of element.typeNames) {
          found.push(model.getType(typeName));
        }
        repeats ||= element.isArray;
        continue;
      }
      if (this.#lenientChoiceSuffix) {
        const choice = findChoiceBySuffix(model, type, name);
        if (choice !== undefined) {
          found.push(model.getType(choice.typeName));
          continue;
        }
      }
      if (type.isAbstract) {
        unknown = true;
        continue;
      }
      missing.push(type);
    }
    if (found.length === 0 && !unknown) {
      if (missing.length > 0) {
        this.#reportUnknownElement(missing, name, node);
      }
      return { types: [], cardinality: 'single', ordered: input.ordered };
    }
    return {
      types: unknown ? undefined : typeSetOf(found),
      cardinality: repeats ? 'collection' : unknown ? 'unknown' : input.cardinality,
      ordered: input.ordered,
    };
  }

  /**
   * `Observation.valueQuantity` names a choice element with its type suffix, which the spec
   * does not allow ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#choice-elements-written-with-a-type-suffix));
   * the hint is the form it allows.
   */
  #reportUnknownElement(types: readonly AnalysisType[], name: string, node: AstNode): void {
    const model = this.#model;
    const subject = describeTypes(types);
    if (model !== undefined) {
      for (const type of types) {
        const choice = isSystemType(type) ? undefined : findChoiceBySuffix(model, type, name);
        if (choice !== undefined) {
          const hint = `${choice.element.name}.ofType(${choice.typeName})`;
          this.#report(
            'error',
            'semantic/unknown-element',
            `${subject} has no element ${name}: ${choice.element.name} is a choice element, which is written without its type; use ${hint}`,
            node,
            hint,
          );
          return;
        }
      }
    }
    this.#report('error', 'semantic/unknown-element', `${subject} has no element ${name}`, node);
  }

  #inferCall(node: FunctionCallNode, scope: Scope): Inferred {
    const name = node.name;
    const definition = this.#registry.get(name);
    const input = node.target === null ? this.#focusOf(scope) : this.infer(node.target, scope);
    if (definition === undefined) {
      this.#report(
        'error',
        'semantic/unknown-function',
        `The function ${name}() is not defined`,
        node,
      );
      return UNKNOWN;
    }
    const { min, max } = arityOf(definition);
    if (node.args.length < min || node.args.length > max) {
      this.#report(
        'error',
        'semantic/wrong-arity',
        `Expected ${describeArity(min, max)} for ${name}(), but found ${node.args.length}`,
        node,
      );
    }
    this.#checkExpectation(input, definition.input, node, `the input of ${name}()`);
    if (definition === iifFunction) {
      return this.#inferIif(node, input, scope);
    }
    if (definition === repeatFunction) {
      return this.#inferRepeat(node, input, scope);
    }
    const values: Inferred[] = [];
    let target: TypeTarget | undefined;
    node.args.forEach((arg, index) => {
      const param = paramAt(definition, index);
      const what = `the ${param?.name ?? `argument ${index + 1}`} of ${name}()`;
      switch (param?.kind ?? 'value') {
        case 'value': {
          const value = this.infer(arg, scope);
          values[index] = value;
          this.#checkExpectation(value, param?.expects, arg, what);
          break;
        }
        case 'lambda': {
          const inner = this.#lambdaScope(scope, input, param, node);
          const value = this.infer(arg, inner);
          values[index] = value;
          this.#checkExpectation(value, param?.expects, arg, what);
          break;
        }
        case 'type':
          target = this.#typeTarget(arg, name);
          break;
        default:
          break;
      }
    });
    return this.#callResult(definition, input, values, target);
  }

  /**
   * The scope of a lambda argument: the focus is one input item (`where`, `select`), or the whole
   * input (`iif`), in which case the guards on `$this` carry over when the input is the focus of
   * the call.
   */
  #lambdaScope(
    scope: Scope,
    input: Inferred,
    param: ParamSpec | undefined,
    node: FunctionCallNode,
  ): Scope {
    if (param?.scope === 'input') {
      return lambdaScope(scope, input, node.target === null);
    }
    return lambdaScope(scope, { types: input.types, cardinality: 'single', ordered: true }, false);
  }

  /**
   * `iif(criterion, true-result, otherwise-result)`: the criterion is a type guard for the
   * branches, each of which is unreachable when the guard rules every type out
   * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#type-guards)).
   */
  #inferIif(node: FunctionCallNode, input: Inferred, scope: Scope): Inferred {
    const [criterion, whenTrue, whenFalse] = node.args;
    const inner = lambdaScope(scope, input, node.target === null);
    let guard: Guard = NO_GUARD;
    if (criterion !== undefined) {
      const result = this.infer(criterion, inner);
      this.#checkExpectation(
        result,
        paramAt(iifFunction, 0)?.expects,
        criterion,
        'the criterion of iif()',
      );
      guard = this.#guardOf(criterion, inner);
    }
    const a =
      whenTrue === undefined
        ? NOTHING
        : this.infer(whenTrue, withConstraints(inner, guard.whenTrue));
    const b =
      whenFalse === undefined
        ? NOTHING
        : this.infer(whenFalse, withConstraints(inner, guard.whenFalse));
    return {
      types: unionTypes(a.types, b.types),
      cardinality: widest(a.cardinality, b.cardinality),
      ordered: a.ordered && b.ordered,
    };
  }

  /**
   * `repeat(projection)`: the projection is applied to the input items and then to every new item
   * it gives ([N1 §5.2.4](https://hl7.org/fhirpath/N1/#repeatprojection-expression-collection)),
   * so inside it the focus may be of any type reachable that way: `Patient.repeat(name | given)`
   * reaches the names, then their given strings. The reachable types are found first, without
   * reporting, and the projection is then analyzed once with all of them, so an element that one
   * reachable type has is not an error. The result holds what the projection gives, and may have
   * any number of items.
   */
  #inferRepeat(node: FunctionCallNode, input: Inferred, scope: Scope): Inferred {
    const [projection] = node.args;
    if (projection === undefined) {
      // The arity is already reported.
      return UNKNOWN;
    }
    const focus: Inferred = {
      types: this.#reachableTypes(projection, input, scope),
      cardinality: 'single',
      ordered: true,
    };
    const result = this.infer(projection, lambdaScope(scope, focus, false));
    // The result is the projected items, in the order the walk finds them: undefined when the
    // projection's is, as for repeat(children()).
    return {
      types: result.types,
      cardinality: 'collection',
      ordered: input.ordered && result.ordered,
    };
  }

  /**
   * The types the focus of a `repeat()` projection may have: the input types, plus what the
   * projection gives on them, and so on until no new type comes. Unknown when the input types
   * are unknown, when the projection gives an unknown type, or when the walk does not settle. An
   * analyzer of its own takes the diagnostics of these passes, which the final pass reports.
   */
  #reachableTypes(projection: ExpressionNode, input: Inferred, scope: Scope): TypeSet {
    let types = input.types;
    if (types === undefined) {
      return undefined;
    }
    const silent = new Analyzer(
      this.#options,
      this.#input,
      new DiagnosticList(this.#options.expression),
    );
    for (let step = 0; step < MAX_REPEAT_STEPS; step++) {
      const focus: Inferred = { types, cardinality: 'single', ordered: true };
      const result = silent.infer(projection, lambdaScope(scope, focus, false));
      const next = unionTypes(types, result.types);
      if (next === undefined) {
        return undefined;
      }
      if (next.length === types.length) {
        return types;
      }
      types = next;
    }
    return undefined;
  }

  /** The type argument of a call such as `ofType(FHIR.Patient)`, resolved. */
  #typeTarget(arg: ExpressionNode, name: string): TypeTarget | undefined {
    const specifier = typeSpecifierOf(arg);
    if (specifier === undefined) {
      this.#report(
        'error',
        'semantic/invalid-argument',
        `Expected a type name as the argument of ${name}()`,
        arg,
      );
      return undefined;
    }
    return this.#resolveTarget(specifier, arg);
  }

  /**
   * Resolves a type specifier as the compiler does. A type that does not resolve is a warning:
   * evaluating the operation raises `eval/unknown-type`, and only then
   * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#unresolved-type-specifiers-are-execution-errors)).
   */
  #resolveTarget(specifier: TypeSpecifier, node: AstNode): TypeTarget {
    const target = resolveTypeTarget(specifier, this.#model);
    if (target.kind === 'unresolved') {
      const text =
        specifier.namespace === undefined
          ? specifier.name
          : `${specifier.namespace}.${specifier.name}`;
      this.#report(
        'warning',
        'semantic/unknown-type',
        `The type ${text} is not defined; evaluating this raises eval/unknown-type`,
        node,
      );
    }
    return target;
  }

  /** What is left of the input after `as`, `ofType()` or a guard with a resolved target. */
  #applyTarget(
    input: Inferred,
    target: TypeTarget | undefined,
    rule: NarrowingRule,
    single: boolean,
  ): Inferred {
    const types =
      target?.kind === 'type' ? narrowTo(input.types, [target.type], this.#model, rule) : undefined;
    return single
      ? { types, cardinality: 'single', ordered: true }
      : { types, cardinality: input.cardinality, ordered: input.ordered };
  }

  /** What a call returns: by the function for the ones whose result depends on their arguments, otherwise by its `returns` hint. */
  #callResult(
    definition: FunctionDefinition,
    input: Inferred,
    values: readonly Inferred[],
    target: TypeTarget | undefined,
  ): Inferred {
    if (definition === isFunction) {
      return singleOf('Boolean');
    }
    if (definition === asFunction) {
      return this.#applyTarget(input, target, 'is', true);
    }
    if (definition === ofTypeFunction) {
      return this.#applyTarget(input, target, 'ofType', false);
    }
    if (definition === selectFunction) {
      const projection = values[0] ?? UNKNOWN;
      return {
        types: projection.types,
        cardinality:
          input.cardinality === 'single'
            ? projection.cardinality
            : widest(input.cardinality, projection.cardinality),
        ordered: input.ordered && projection.ordered,
      };
    }
    if (definition === unionFunction || definition === combineFunction) {
      return unionOf(input, values[0] ?? UNKNOWN);
    }
    const hint = definition.returns;
    if (hint === undefined) {
      return UNKNOWN;
    }
    const fromInput = hint.fromInput === true;
    const singleton = hint.singleton === true;
    return {
      types:
        hint.type !== undefined
          ? typeSetOf([SYSTEM_TYPES[hint.type]])
          : fromInput
            ? input.types
            : undefined,
      cardinality: singleton ? 'single' : fromInput ? input.cardinality : 'unknown',
      ordered: hint.ordered === false ? false : singleton || !fromInput ? true : input.ordered,
    };
  }

  #inferTypeOperation(node: TypeOperationNode, scope: Scope): Inferred {
    const operand = this.infer(node.operand, scope);
    this.#checkSingleton(operand, node.operand, `the operand of ${node.op}`);
    const [first, ...rest] = node.type.identifiers;
    if (first === undefined) {
      // The parser never produces this; only a hand-made AST can.
      this.#report(
        'error',
        'semantic/invalid-argument',
        `Expected a type name after ${node.op}`,
        node.type,
      );
      return UNKNOWN;
    }
    const target = this.#resolveTarget(typeSpecifierFromIdentifiers([first, ...rest]), node.type);
    return node.op === 'is' ? singleOf('Boolean') : this.#applyTarget(operand, target, 'is', true);
  }

  /**
   * `target[index]` ([N1 §6.7.1](https://hl7.org/fhirpath/N1/#index-integer-collection)): one
   * item of the target, chosen by its position, which is undefined after `children()` or
   * `descendants()`.
   */
  #inferIndexer(node: IndexerNode, scope: Scope): Inferred {
    const target = this.infer(node.target, scope);
    const index = this.infer(node.index, scope);
    this.#checkExpectation(index, INDEX, node.index, 'the index', true);
    this.#checkOrdered(target, node, 'the indexer');
    return { types: target.types, cardinality: 'single', ordered: true };
  }

  /** `+x` and `-x` ([N1 §6.6](https://hl7.org/fhirpath/N1/#math)) take a number or a Quantity. */
  #inferUnary(node: UnaryNode, scope: Scope): Inferred {
    const operand = this.infer(node.operand, scope);
    this.#checkExpectation(operand, POLARITY, node, `the operand of unary ${node.op}`, true);
    return { types: operand.types, cardinality: 'single', ordered: true };
  }

  #inferBinary(node: BinaryNode, scope: Scope): Inferred {
    switch (node.op) {
      case 'and':
      case 'or':
      case 'xor':
      case 'implies':
        return this.#inferLogic(node, scope);
      case '|':
        return unionOf(this.infer(node.left, scope), this.infer(node.right, scope));
      case 'in': {
        const left = this.infer(node.left, scope);
        this.infer(node.right, scope);
        this.#checkSingleton(left, node.left, 'the left operand of in');
        return singleOf('Boolean');
      }
      case 'contains': {
        this.infer(node.left, scope);
        const right = this.infer(node.right, scope);
        this.#checkSingleton(right, node.right, 'the right operand of contains');
        return singleOf('Boolean');
      }
      case '=':
      case '!=':
      case '~':
      case '!~':
        return this.#inferEquality(node, scope);
      case '<':
      case '>':
      case '<=':
      case '>=':
        return this.#inferComparison(node, scope);
      case '&':
        return this.#inferConcatenation(node, scope);
      case '+':
      case '-':
      case '*':
      case '/':
      case 'div':
      case 'mod':
        return this.#inferArithmetic(node, node.op, scope);
      default:
        return assertNever(node.op, 'operator');
    }
  }

  /**
   * `and`, `or`, `xor` and `implies` ([N1 §6.5](https://hl7.org/fhirpath/N1/#boolean-logic)):
   * each operand is a Boolean by singleton evaluation. The left operand is a type guard for the
   * right one: `A and B` and `A implies B` analyze `B` as if `A` were true, `A or B` as if `A`
   * were false ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#type-guards)).
   */
  #inferLogic(node: BinaryNode, scope: Scope): Inferred {
    const left = this.infer(node.left, scope);
    this.#checkExpectation(left, BOOLEAN, node.left, `the left operand of ${node.op}`);
    let rightScope = scope;
    if (node.op === 'and' || node.op === 'implies') {
      rightScope = withConstraints(scope, this.#guardOf(node.left, scope).whenTrue);
    } else if (node.op === 'or') {
      rightScope = withConstraints(scope, this.#guardOf(node.left, scope).whenFalse);
    }
    const right = this.infer(node.right, rightScope);
    this.#checkExpectation(right, BOOLEAN, node.right, `the right operand of ${node.op}`);
    return singleOf('Boolean');
  }

  /**
   * What a Boolean expression says about the types of the paths in it, when it is true and when
   * it is false: `X is T` and `X.is(T)` narrow `X` to `T` when true and exclude `T` when false;
   * `not()` swaps the two; `and` and `or` combine them. Anything else says nothing.
   */
  #guardOf(node: ExpressionNode, scope: Scope): Guard {
    switch (node.kind) {
      case 'TypeOperation': {
        if (node.op !== 'is') {
          return NO_GUARD;
        }
        const [first, ...rest] = node.type.identifiers;
        return first === undefined
          ? NO_GUARD
          : this.#typeGuard(node.operand, typeSpecifierFromIdentifiers([first, ...rest]));
      }
      case 'FunctionCall': {
        const definition = this.#registry.get(node.name);
        const [arg] = node.args;
        if (definition === isFunction && arg !== undefined && node.args.length === 1) {
          const specifier = typeSpecifierOf(arg);
          return specifier === undefined ? NO_GUARD : this.#typeGuard(node.target, specifier);
        }
        if (definition === notFunction && node.target !== null && node.args.length === 0) {
          return negateGuard(this.#guardOf(node.target, scope));
        }
        return NO_GUARD;
      }
      case 'Binary': {
        if (node.op !== 'and' && node.op !== 'or') {
          return NO_GUARD;
        }
        const left = this.#guardOf(node.left, scope);
        const right = this.#guardOf(node.right, scope);
        return node.op === 'and'
          ? {
              whenTrue: bothGuards(left.whenTrue, right.whenTrue),
              whenFalse: eitherGuard(left.whenFalse, right.whenFalse),
            }
          : {
              whenTrue: eitherGuard(left.whenTrue, right.whenTrue),
              whenFalse: bothGuards(left.whenFalse, right.whenFalse),
            };
      }
      default:
        return NO_GUARD;
    }
  }

  /** The guard of `operand is T`; a null operand is the focus. */
  #typeGuard(operand: ExpressionNode | null, specifier: TypeSpecifier): Guard {
    const key = operand === null ? '$this' : pathKey(operand);
    const target = resolveTypeTarget(specifier, this.#model);
    if (key === undefined || target.kind !== 'type') {
      return NO_GUARD;
    }
    return {
      whenTrue: [{ key, include: [target.type] }],
      whenFalse: [{ key, exclude: [target.type] }],
    };
  }

  /**
   * `=`, `!=`, `~` and `!~` compare whole collections, so they raise no type errors
   * ([N1 §6.1](https://hl7.org/fhirpath/N1/#equality)). Strict mode reports the two unsafe uses of
   * N1 §11: a single item compared with a collection, and two single items that can never be
   * equal because of their types.
   */
  #inferEquality(node: BinaryNode, scope: Scope): Inferred {
    const left = this.infer(node.left, scope);
    const right = this.infer(node.right, scope);
    if (this.#strict) {
      const single = left.cardinality === 'single' && right.cardinality === 'single';
      if (
        (left.cardinality === 'single' && right.cardinality === 'collection') ||
        (left.cardinality === 'collection' && right.cardinality === 'single')
      ) {
        this.#report(
          'error',
          'semantic/singleton-expected',
          `One operand of ${node.op} may have more than one item while the other has one; compare two collections or two single items`,
          node,
        );
      } else if (single && hasKnownTypes(left) && hasKnownTypes(right)) {
        this.#checkPairs(
          node,
          left,
          right,
          isEqualityNever,
          (a, b) => `Values of ${a} and ${b} are never equal`,
        );
      }
    }
    return singleOf('Boolean');
  }

  /**
   * `<`, `>`, `<=` and `>=` ([N1 §6.2](https://hl7.org/fhirpath/N1/#comparison)) order two single
   * values of types that have an order; other types raise `eval/type-mismatch`.
   */
  #inferComparison(node: BinaryNode, scope: Scope): Inferred {
    const left = this.infer(node.left, scope);
    const right = this.infer(node.right, scope);
    this.#checkSingleton(left, node.left, `the left operand of ${node.op}`);
    this.#checkSingleton(right, node.right, `the right operand of ${node.op}`);
    this.#checkPairs(
      node,
      left,
      right,
      (a, b) => !isComparable(a, b),
      (a, b) => `Cannot compare ${a} with ${b}`,
    );
    return singleOf('Boolean');
  }

  /** `&` takes Strings, and an empty operand as `''` ([N1 §6.6.6](https://hl7.org/fhirpath/N1/#string-concatenation)). */
  #inferConcatenation(node: BinaryNode, scope: Scope): Inferred {
    for (const operand of [node.left, node.right]) {
      const inferred = this.infer(operand, scope);
      this.#checkSingleton(inferred, operand, 'an operand of &');
      const kinds = kindsOf(inferred.types, this.#model);
      if (kinds !== undefined && kinds.length > 0 && !kinds.includes('String')) {
        this.#report(
          this.#operatorSeverity(),
          'semantic/type-mismatch',
          `& takes Strings, but found ${withArticle(describeTypes(inferred.types ?? []))}`,
          operand,
        );
      }
    }
    return singleOf('String');
  }

  /**
   * The math operators ([N1 §6.6](https://hl7.org/fhirpath/N1/#math)), including `+` on Strings
   * and `+`/`-` on a date/time value and a quantity.
   */
  #inferArithmetic(node: BinaryNode, op: ArithmeticOperator, scope: Scope): Inferred {
    const left = this.infer(node.left, scope);
    const right = this.infer(node.right, scope);
    this.#checkSingleton(left, node.left, `the left operand of ${op}`);
    this.#checkSingleton(right, node.right, `the right operand of ${op}`);
    if (isNothing(left) || isNothing(right)) {
      return NOTHING;
    }
    const leftKinds = kindsOf(left.types, this.#model);
    const rightKinds = kindsOf(right.types, this.#model);
    const accepts = (a: ValueKind, b: ValueKind) => arithmeticResult(op, a, b) !== undefined;
    this.#checkPairs(
      node,
      left,
      right,
      (a, b) => !accepts(a, b),
      (a, b) => `The operator ${op} does not accept ${a} and ${b}`,
    );
    if (op === '+' || op === '-') {
      this.#checkTemporalArithmetic(node, leftKinds);
    }
    if (leftKinds === undefined || rightKinds === undefined) {
      return { types: undefined, cardinality: 'single', ordered: true };
    }
    const results: AnalysisType[] = [];
    for (const a of leftKinds) {
      for (const b of rightKinds) {
        const result = arithmeticResult(op, a, b);
        if (result !== undefined && result !== 'Complex') {
          results.push(SYSTEM_TYPES[result]);
        }
      }
    }
    return { types: typeSetOf(results), cardinality: 'single', ordered: true };
  }

  /**
   * Reports a binary operator whose operands can never be accepted together: when both sides are
   * known, no pair of possible kinds is accepted; when one side is known, no kind of it is
   * accepted with any kind at all.
   */
  #checkPairs(
    node: BinaryNode,
    left: Inferred,
    right: Inferred,
    rejects: (a: ValueKind, b: ValueKind) => boolean,
    message: (left: string, right: string) => string,
  ): void {
    const leftKinds = kindsOf(left.types, this.#model);
    const rightKinds = kindsOf(right.types, this.#model);
    const accepts = (a: ValueKind, b: ValueKind) => !rejects(a, b);
    let rejected: boolean;
    if (leftKinds !== undefined && rightKinds !== undefined) {
      rejected =
        leftKinds.length > 0 && rightKinds.length > 0 && !somePair(leftKinds, rightKinds, accepts);
    } else if (leftKinds !== undefined) {
      rejected = leftKinds.length > 0 && !somePair(leftKinds, VALUE_KINDS, accepts);
    } else if (rightKinds !== undefined) {
      rejected = rightKinds.length > 0 && !somePair(VALUE_KINDS, rightKinds, accepts);
    } else {
      rejected = false;
    }
    if (rejected) {
      this.#report(
        this.#operatorSeverity(),
        'semantic/type-mismatch',
        message(describeSide(left), describeSide(right)),
        node,
      );
    }
  }

  /**
   * An operator whose operands it never accepts raises `eval/type-mismatch` when evaluated. That
   * is a warning here and an error in strict mode, where N1 §11 lists it as an unsafe use; the
   * HL7 test suite expects the execution error otherwise (`testMinus4`, `testPrecedence3`).
   */
  #operatorSeverity(): Diagnostic['severity'] {
    return this.#strict ? 'error' : 'warning';
  }

  /**
   * `+` and `-` on a Date, DateTime or Time and a quantity literal
   * ([3.0.0 date/time arithmetic](https://hl7.org/fhirpath/STU3/#datetime-arithmetic)): a unit
   * that the value cannot take is an error, and a quantity of which part is ignored is a warning,
   * as 3.0.0 asks ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#fractions-in-datetime-arithmetic)).
   * Only when the left operand is known to be a date/time value, and nothing for a quantity that
   * is computed when the expression is evaluated.
   */
  #checkTemporalArithmetic(node: BinaryNode, leftKinds: readonly ValueKind[] | undefined): void {
    const literal = quantityLiteralOf(node.right);
    if (
      literal === undefined ||
      leftKinds === undefined ||
      leftKinds.length === 0 ||
      !leftKinds.every(isTemporalKind)
    ) {
      return;
    }
    const amount = literal.number === undefined ? undefined : Decimal.parse(literal.number);
    const unit = literal.unit;
    if (amount === undefined || unit === undefined) {
      return;
    }
    const magnitude = timeUnitMagnitude(unit);
    if (magnitude !== undefined) {
      if (leftKinds.every((kind) => kind === 'Date') && !isDateUnit(magnitude)) {
        this.#report(
          this.#operatorSeverity(),
          'semantic/type-mismatch',
          'A Date can only be changed by years, months, weeks or days',
          node,
        );
        return;
      }
      if (leftKinds.every((kind) => kind === 'Time') && isDateUnit(magnitude)) {
        this.#report(
          this.#operatorSeverity(),
          'semantic/type-mismatch',
          'A Time can only be changed by hours, minutes, seconds or milliseconds',
          node,
        );
        return;
      }
    }
    let ignored: boolean;
    let dropsFraction: boolean;
    try {
      dropsFraction = isFractionIgnored(amount, unit);
      ignored = dropsFraction || isFractionIgnored(amount, unit, temporalPrecisionOf(node.left));
    } catch (error) {
      // The kernel rejects the unit, so the evaluation raises this error; say so now.
      if (error instanceof FhirPathEvaluationError && error.code === 'eval/invalid-calendar-unit') {
        this.#report(this.#operatorSeverity(), 'semantic/type-mismatch', error.message, node);
        return;
      }
      throw error;
    }
    if (ignored) {
      this.#report(
        'warning',
        'semantic/fraction-ignored',
        dropsFraction
          ? `Date/time arithmetic ignores the fraction of ${literal.raw}: a fraction of a unit above seconds, or of a millisecond, is dropped`
          : `Date/time arithmetic ignores part of ${literal.raw}: it is finer than the precision of ${describeLeft(node.left)}`,
        node,
      );
    }
  }

  /**
   * Checks a value against what a function expects of its input or an argument, or an operator
   * of an operand. A type that never fits is an error for a function and a warning for an
   * operator ({@link Analyzer.#operatorSeverity}), except where a Boolean is expected of a single
   * item: there a value of another type counts as true
   * ([N1 §4.5](https://hl7.org/fhirpath/N1/#singleton-evaluation-of-collections)), so only strict
   * mode reports it. Cardinality and order are strict-mode checks.
   */
  #checkExpectation(
    inferred: Inferred,
    expectation: TypeExpectation | undefined,
    node: AstNode,
    what: string,
    operator = false,
  ): void {
    if (expectation === undefined) {
      return;
    }
    const expected = expectation.type;
    if (
      expected !== undefined &&
      hasKnownTypes(inferred) &&
      !someFits(inferred.types, expected, this.#model)
    ) {
      const booleanRule = expected === 'Boolean' && expectation.singleton === true;
      if (!booleanRule || this.#strict) {
        this.#report(
          operator ? this.#operatorSeverity() : 'error',
          'semantic/type-mismatch',
          `Expected ${describeExpectation(expected)} for ${what}, but found ${withArticle(describeTypes(inferred.types))}`,
          node,
        );
      }
    }
    if (expectation.singleton === true) {
      this.#checkSingleton(inferred, node, what);
    }
    if (expectation.ordered === true) {
      this.#checkOrdered(inferred, node, what);
    }
  }

  /** Strict mode: a value that may repeat where a single item is expected (N1 §11). */
  #checkSingleton(inferred: Inferred, node: AstNode, what: string): void {
    if (this.#strict && inferred.cardinality === 'collection') {
      this.#report(
        'error',
        'semantic/singleton-expected',
        `Expected a single item for ${what}, but it may have more than one; select one with first(), single() or the indexer`,
        node,
      );
    }
  }

  /** Strict mode: an order-dependent operation on `children()` or `descendants()` (N1 §3.1). */
  #checkOrdered(inferred: Inferred, node: AstNode, what: string): void {
    if (this.#strict && !inferred.ordered) {
      this.#report(
        'error',
        'semantic/unordered-collection',
        `The order of the items is undefined after children() or descendants(), so ${what} cannot depend on it`,
        node,
      );
    }
  }
}

function inferLiteral(node: LiteralNode): Inferred {
  switch (node.type) {
    case 'Empty':
      return NOTHING;
    case 'Boolean':
    case 'String':
    case 'Integer':
    case 'Decimal':
    case 'Date':
    case 'DateTime':
    case 'Time':
    case 'Quantity':
      return singleOf(node.type);
    default:
      return assertNever(node.type, 'literal type');
  }
}

/** The value, or {@link NOTHING} when it can have no item, so that nothing is checked on it. */
function nothingOr(inferred: Inferred): Inferred {
  return isNothing(inferred) ? NOTHING : inferred;
}

/** The union of two values, for `|`, `union()` and `combine()`. */
function unionOf(left: Inferred, right: Inferred): Inferred {
  if (isNothing(left)) {
    return right;
  }
  if (isNothing(right)) {
    return left;
  }
  return {
    types: unionTypes(left.types, right.types),
    cardinality:
      left.cardinality === 'unknown' || right.cardinality === 'unknown' ? 'unknown' : 'collection',
    ordered: left.ordered && right.ordered,
  };
}

/** The cardinality that covers both. */
function widest(a: Cardinality, b: Cardinality): Cardinality {
  if (a === 'collection' || b === 'collection') {
    return 'collection';
  }
  return a === 'unknown' || b === 'unknown' ? 'unknown' : 'single';
}

/** Whether two kinds can never be equal, for the strict-mode check of `=`. */
function isEqualityNever(a: ValueKind, b: ValueKind): boolean {
  return a !== b && !isComparable(a, b);
}

/** The types of an operand for people, or `an unknown value`. */
function describeSide(inferred: Inferred): string {
  return hasKnownTypes(inferred) ? withArticle(describeTypes(inferred.types)) : 'an unknown value';
}

/**
 * The type name written as a function argument, as in `ofType(FHIR.Patient)`, or undefined when
 * the argument is not a (qualified) identifier. The same reading as the compiler's.
 */
function typeSpecifierOf(arg: ExpressionNode): TypeSpecifier | undefined {
  const rest: string[] = [];
  let current = arg;
  while (current.kind === 'Member') {
    rest.unshift(current.name);
    current = current.target;
  }
  return current.kind === 'Identifier'
    ? typeSpecifierFromIdentifiers([current.name, ...rest])
    : undefined;
}

/** A quantity literal, possibly behind `+` or `-`, which the compiler folds into the value. */
function quantityLiteralOf(node: ExpressionNode): LiteralNode | undefined {
  let current = node;
  while (current.kind === 'Unary') {
    current = current.operand;
  }
  return current.kind === 'Literal' && current.type === 'Quantity' ? current : undefined;
}

/** The precision of a date/time literal, or undefined for any other expression. */
function temporalPrecisionOf(node: ExpressionNode): Precision | undefined {
  if (node.kind !== 'Literal') {
    return undefined;
  }
  switch (node.type) {
    case 'Date':
    case 'DateTime':
    case 'Time':
      return parseTemporalLiteral(node.raw)?.precision;
    default:
      return undefined;
  }
}

/** The left operand of date/time arithmetic for people: the literal, or `the value`. */
function describeLeft(node: ExpressionNode): string {
  return node.kind === 'Literal' ? node.raw : 'the value';
}

/** The units a Date takes: years to days. A Time takes the others. */
function isDateUnit(unit: CalendarUnit): boolean {
  return unit === 'year' || unit === 'month' || unit === 'week' || unit === 'day';
}
