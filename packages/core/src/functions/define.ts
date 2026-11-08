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

/** One parameter of a function. */
export interface ParamSpec {
  readonly kind: ParamKind;
  /** The name used in error messages and documentation, as in the spec. */
  readonly name?: string;
  /** May be left out. Optional parameters follow the required ones. */
  readonly optional?: boolean;
  /** Takes any number of arguments, including none. Only the last parameter can be variadic. */
  readonly variadic?: boolean;
}

/**
 * What a function returns, for static analysis (T0024): the System type of its items when it is
 * fixed, and whether the result has at most one item.
 */
export interface TypeHint {
  readonly type?: SystemTypeName;
  readonly singleton?: boolean;
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
  /** For the analyzer. */
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
 * shows when the definition is made, not when a call is compiled.
 *
 * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` for an empty name, an unknown
 *   parameter kind, a required parameter after an optional one, or a variadic parameter that is
 *   not the last.
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
    if (param.variadic === true && index !== params.length - 1) {
      throw invalidDefinition(`only the last parameter of ${name}() can be variadic`);
    }
    if (param.optional === true || param.variadic === true) {
      optional = true;
    } else if (optional) {
      throw invalidDefinition(`a required parameter of ${name}() follows an optional one`);
    }
  });
  return Object.freeze({
    ...definition,
    params: Object.freeze(params.map((p) => Object.freeze({ ...p }))),
  });
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
 */
export function defineValueFunction(
  name: string,
  params: number | readonly ParamSpec[],
  impl: (input: Collection, args: readonly Collection[], call: CallContext) => Collection,
  options: { readonly returns?: TypeHint } = {},
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
