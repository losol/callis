/**
 * How FHIRPath functions are defined ([T0008: function library](https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#function-library)).
 *
 * A {@link FunctionDefinition} declares its parameters, so the compiler can check calls once, at
 * compile time, and knows how to pass each argument: evaluated (`value`), as a closure that the
 * function evaluates per item (`lambda`), or as a type specifier resolved at compile time
 * (`type`).
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import type { SourceSpan } from '../errors/source-span.ts';
import { type Collection, EMPTY, type Item } from '../runtime/collection.ts';
import type { EvalContext, Frame } from '../runtime/context.ts';
import type { MaybePromise } from '../runtime/maybe-promise.ts';
import type { TypeTarget } from '../runtime/type-target.ts';
import type { SystemTypeName } from '../types/system-types.ts';

/**
 * How an argument is passed to a function.
 *
 * - `value`: evaluated before the call, with the same focus as the call itself. `combine(other)`.
 * - `lambda`: compiled to a closure that the function evaluates, per item or lazily.
 *   `where(criteria)`, `iif(criterion, …)`.
 * - `type`: a type specifier, resolved once at compile time. `ofType(type)`.
 */
export type ParamKind = 'value' | 'lambda' | 'type';

/** How a function evaluates a lambda parameter, which decides the focus and `$this` inside it. */
export type LambdaScope = 'item' | 'input';

/** One parameter of a function. */
export interface ParamSpec {
  readonly kind: ParamKind;
  /** The name used in error messages and documentation, as in the spec. */
  readonly name?: string;
  /** May be left out. Optional parameters follow the required ones. */
  readonly optional?: boolean;
  /** Takes any number of arguments, including none. Only the last parameter can be variadic. */
  readonly variadic?: boolean;
  /**
   * For static analysis: what a value argument, or the result of a lambda argument, must be. The
   * implementation still checks at runtime; the analyzer reports what it can see earlier.
   */
  readonly expects?: TypeExpectation;
  /**
   * For a lambda parameter: whether the function evaluates it for each input item, with the
   * item as the focus and `$this` ({@link LambdaArg.forItem}, as `where()` and `select()` do), or
   * once for the whole input, with the input as the focus and `$this`
   * ({@link LambdaArg.forInput}, as `iif()` does). `item` by default. Static analysis infers the
   * focus of the lambda from it.
   */
  readonly scope?: LambdaScope;
}

/**
 * What a function expects of its input or of an argument, for static analysis (T0024). A
 * function that declares nothing accepts anything there; the analyzer then only checks what the
 * registry checks, the name and the number of arguments.
 */
export interface TypeExpectation {
  /**
   * The System types the items may have, or `primitive` for any value that converts to a System
   * value, as the conversion functions take: a System value, a FHIR primitive or a Quantity.
   * The analyzer reports a value none of whose possible types fits (`'a'.abs()`). Unset: any
   * type. A model primitive fits the System type it maps to, and the implicit conversions apply:
   * an Integer fits `Decimal`, a Date fits `DateTime`, and a number fits `Quantity`.
   */
  readonly type?: SystemTypeName | readonly SystemTypeName[] | 'primitive';
  /**
   * Whether at most one item is expected, so more raise `eval/singleton-expected`. Strict analysis
   * reports a value that may repeat ([N1 §11](https://hl7.org/fhirpath/N1/#type-safety-and-strict-evaluation)).
   */
  readonly singleton?: boolean;
  /**
   * Whether the result depends on the order of the items, as it does for `first()` and `skip()`.
   * Strict analysis reports an input whose order is undefined, from `children()` or
   * `descendants()` ([N1 §3.1](https://hl7.org/fhirpath/N1/#collections)).
   */
  readonly ordered?: boolean;
}

/**
 * What a function returns, for static analysis (T0024): the System type of its items when it is
 * fixed, whether the result has at most one item, whether its order is defined, and whether its
 * items come from the input.
 */
export interface TypeHint {
  readonly type?: SystemTypeName;
  readonly singleton?: boolean;
  /**
   * False when the order of the result is undefined, as for `children()` and `descendants()`
   * ([N1 §3.1](https://hl7.org/fhirpath/N1/#collections)). True by default.
   */
  readonly ordered?: boolean;
  /**
   * True when the items are input items, selected or kept, as for `where()`, `first()` and
   * `distinct()`: the result has the types of the input items and, unless it is a singleton, the
   * input's order and cardinality. `'value'` when the items are the System values of the input
   * items, as for `abs()`, which converts a model node first: a FHIR `positiveInt` gives an
   * Integer and an `Age` a Quantity.
   */
  readonly fromInput?: boolean | 'value';
}

/**
 * A lambda argument, bound to the call. The function decides when and how often it is evaluated.
 */
export interface LambdaArg {
  readonly kind: 'lambda';
  /**
   * Evaluates the argument for one item, as `where()` and `select()` do: the item is the focus and
   * `$this`, `index` is `$index` ([N1 §5](https://hl7.org/fhirpath/N1/#functions)), and `total`
   * is `$total` for `aggregate()`.
   */
  forItem(item: Item, index: number, total?: Collection): MaybePromise<Collection>;
  /**
   * Evaluates the argument once for the whole input, as the arguments of `iif()` are: `input` is
   * the focus and `$this`, also when it is empty, and `$index` and `$total` stay those of the
   * call ([3.0.0 iif](https://hl7.org/fhirpath/STU3/en/index.html#iifcriterion-this--boolean-true-result-this--collection--otherwise-result-this--collection--collection)).
   */
  forInput(input: Collection): MaybePromise<Collection>;
  /**
   * Evaluates the argument where the call is written, with the call's focus and iteration
   * variables.
   */
  inPlace(): MaybePromise<Collection>;
}

/** A type argument: the type specifier, resolved at compile time. */
export interface TypeArg {
  readonly kind: 'type';
  readonly target: TypeTarget;
}

/** An argument as a function receives it, by the kind of its parameter. */
export type Arg = Collection | LambdaArg | TypeArg;

/** What a function implementation knows about its call. */
export interface CallContext {
  /** The evaluation. */
  readonly ctx: EvalContext;
  /** The iteration variables where the function is called. */
  readonly frame: Frame;
  /** The function name as written. */
  readonly name: string;
  /** Where the call is in the expression, for hooks such as `trace()`. */
  readonly span: SourceSpan;
}

/**
 * The implementation of a function: the input collection and the arguments, by parameter.
 *
 * It may return any thenable, such as a promise from another realm; the engine adopts it in async
 * mode and raises `eval/async-in-sync` in sync mode.
 */
export type FunctionImpl = (
  call: CallContext,
  input: Collection,
  args: readonly Arg[],
) => Collection | PromiseLike<Collection>;

/** A FHIRPath function. */
export interface FunctionDefinition {
  /** The name, case-sensitive, as in `where`. */
  readonly name: string;
  readonly params: readonly ParamSpec[];
  /** For static analysis: what the input must be. Unset: anything. */
  readonly input?: TypeExpectation;
  /** For static analysis: what the function returns. Unset: unknown. */
  readonly returns?: TypeHint;
  /** Whether the function may call host hooks, so its result may be a promise in async mode. */
  readonly async?: boolean;
  readonly impl: FunctionImpl;
}

/** The number of arguments a function accepts: at least `min`, at most `max`. */
export interface Arity {
  readonly min: number;
  readonly max: number;
}

/** The arity of a function, from its parameters. A variadic parameter allows any number. */
export function arityOf(definition: FunctionDefinition): Arity {
  let min = 0;
  for (const param of definition.params) {
    if (param.optional !== true && param.variadic !== true) {
      min++;
    }
  }
  const variadic = definition.params.at(-1)?.variadic === true;
  return { min, max: variadic ? Number.POSITIVE_INFINITY : definition.params.length };
}

/**
 * The parameter that argument `index` is passed to: its own, or the variadic last one.
 * Undefined beyond the arity.
 */
export function paramAt(definition: FunctionDefinition, index: number): ParamSpec | undefined {
  const { params } = definition;
  const last = params.at(-1);
  if (index >= params.length && last?.variadic === true) {
    return last;
  }
  return params[index];
}

/**
 * Checks a function definition and returns it frozen. Use it for every definition, so a mistake
 * shows when the definition is made, not when a call is compiled. A definition that is already
 * frozen, parameters included, is returned as it is, so a registry holds the very objects the
 * library defines and the analyzer can recognize `iif()`, `is()` and `not()` by identity.
 *
 * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` for an empty name, an unknown
 *   parameter kind or lambda scope, a required parameter after an optional one, or a variadic
 *   parameter that is not the last.
 */
export function defineFunction(definition: FunctionDefinition): FunctionDefinition {
  const { name, params } = definition;
  if (typeof name !== 'string' || name.length === 0) {
    throw invalidDefinition('a function needs a name');
  }
  if (typeof definition.impl !== 'function') {
    throw invalidDefinition(`${name}() needs an implementation`);
  }
  let optional = false;
  params.forEach((param, index) => {
    if (param.kind !== 'value' && param.kind !== 'lambda' && param.kind !== 'type') {
      throw invalidDefinition(`parameter ${index + 1} of ${name}() has an unknown kind`);
    }
    if (param.scope !== undefined && (param.kind !== 'lambda' || !isLambdaScope(param.scope))) {
      throw invalidDefinition(`parameter ${index + 1} of ${name}() has an invalid scope`);
    }
    if (param.variadic === true && index !== params.length - 1) {
      throw invalidDefinition(`only the last parameter of ${name}() can be variadic`);
    }
    if (param.optional === true || param.variadic === true) {
      optional = true;
    } else if (optional) {
      throw invalidDefinition(`a required parameter of ${name}() follows an optional one`);
    }
  });
  if (Object.isFrozen(definition) && Object.isFrozen(params) && params.every(Object.isFrozen)) {
    return definition;
  }
  return Object.freeze({
    ...definition,
    params: Object.freeze(params.map((p) => Object.freeze({ ...p }))),
  });
}

function isLambdaScope(scope: string): scope is LambdaScope {
  return scope === 'item' || scope === 'input';
}

function invalidDefinition(problem: string): FhirPathEvaluationError {
  return new FhirPathEvaluationError(
    'eval/invalid-argument',
    `Invalid function definition: ${problem}`,
  );
}

/**
 * Defines a function whose parameters are all values: the arguments arrive evaluated, as
 * collections. Most library functions are value functions.
 *
 * @param params - The parameters, or how many required value parameters there are.
 * @param options - The analysis hints: what the input must be and what the function returns.
 */
export function defineValueFunction(
  name: string,
  params: number | readonly ParamSpec[],
  impl: (input: Collection, args: readonly Collection[], call: CallContext) => Collection,
  options: { readonly input?: TypeExpectation; readonly returns?: TypeHint } = {},
): FunctionDefinition {
  const specs: readonly ParamSpec[] =
    typeof params === 'number' ? Array.from({ length: params }, () => ({ kind: 'value' })) : params;
  return defineFunction({
    name,
    params: specs,
    ...options,
    impl: (call, input, args) =>
      impl(
        input,
        args.map((_, index) => valueArg(args, index)),
        call,
      ),
  });
}

/** Whether an argument is a value argument, an evaluated collection. */
export function isValueArg(arg: Arg): arg is Collection {
  return Array.isArray(arg);
}

/**
 * The value argument at `index`, or empty when it was left out.
 *
 * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` if that argument is not a value.
 */
export function valueArg(args: readonly Arg[], index: number): Collection {
  const arg = args[index];
  if (arg === undefined) {
    return EMPTY;
  }
  if (!isValueArg(arg)) {
    throw wrongArgumentKind(index, 'value');
  }
  return arg;
}

/**
 * The lambda argument at `index`, or undefined when it was left out.
 *
 * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` if that argument is not a lambda.
 */
export function lambdaArg(args: readonly Arg[], index: number): LambdaArg | undefined {
  const arg = args[index];
  if (arg === undefined) {
    return undefined;
  }
  if (isValueArg(arg) || arg.kind !== 'lambda') {
    throw wrongArgumentKind(index, 'lambda');
  }
  return arg;
}

/**
 * The type argument at `index`.
 *
 * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` if that argument is missing or
 *   not a type.
 */
export function typeArg(args: readonly Arg[], index: number): TypeTarget {
  const arg = args[index];
  if (arg === undefined || isValueArg(arg) || arg.kind !== 'type') {
    throw wrongArgumentKind(index, 'type');
  }
  return arg.target;
}

function wrongArgumentKind(index: number, kind: ParamKind): FhirPathEvaluationError {
  return new FhirPathEvaluationError(
    'eval/invalid-argument',
    `Expected argument ${index + 1} to be a ${kind} argument`,
  );
}
