/**
 * The internal compile and evaluate API ([T0008](https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md)).
 * The conformance runner's adapter uses it. T0025 builds the public API on it, with option
 * validation, the compile cache and the final output adapters
 * ([T0025: public API sketch](https://github.com/losol/callis/blob/main/docs/tasks/T0025-public-api-release.md#public-api-sketch)).
 */
import { compileExpression } from '../compiler/compile.ts';
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import type { SourceSpan } from '../errors/source-span.ts';
import { fhirEquivalence } from '../fhir/equivalence.ts';
import { createFhirEnvironment } from '../fhir/variables.ts';
import { createRegistry, type FunctionRegistry } from '../functions/registry.ts';
import type { ModelProvider } from '../model/model-provider.ts';
import type { ExpressionNode } from '../parser/ast.ts';
import { parse } from '../parser/parser.ts';
import {
  type EvalContext,
  type Evaluator,
  type Limits,
  rootFrame,
  type TraceSink,
} from '../runtime/context.ts';
import { adoptResult, andThen, type MaybePromise, requireSync } from '../runtime/maybe-promise.ts';
import { toInputCollection } from '../runtime/navigation.ts';
import { createVariables } from '../runtime/variables.ts';
import {
  type NowSnapshot,
  resolveTimezoneOffset,
  takeNowSnapshot,
} from '../values/datetime/now.ts';
import { minimalUnitSystem, type UnitSystem } from '../values/quantity/unit-system.ts';
import { type OutputOptions, toOutput } from './output.ts';

/**
 * Compatibility relaxations of the spec's rules
 * ([ADR-0012](https://github.com/losol/callis/blob/main/docs/adr/0012-evaluation-defaults.md)).
 * Everything is off by default.
 */
export interface LenientOptions {
  /**
   * Accept a choice element written with its type suffix, as in `Observation.valueQuantity`,
   * which other engines allow. The spec's form is `Observation.value.ofType(Quantity)`.
   */
  readonly choiceSuffix?: boolean;
}

/** Options that apply when an expression is compiled. */
export interface CompileOptions {
  /**
   * The model for type specifiers and type-directed navigation: choice elements, FHIR primitives
   * with their extensions, inheritance. Without one, plain JSON is navigated by its keys.
   */
  readonly model?: ModelProvider;
  /** The unit system for quantities; the minimal built-in one by default. */
  readonly units?: UnitSystem;
  /** The functions calls resolve to; the standard library and the FHIR functions by default. */
  readonly functions?: FunctionRegistry;
  /** Compatibility relaxations; none by default. */
  readonly lenient?: LenientOptions;
}

/**
 * One call of `trace()`
 * ([N1 §5.9.1](https://hl7.org/fhirpath/N1/#tracename-string-projection-expression-collection)).
 */
export interface TraceEvent {
  /** The `name` argument. */
  readonly name: string;
  /**
   * The traced collection, converted like a result of the evaluation (`output` and
   * `decimalOutput`): the input of `trace()`, or the result of its projection.
   */
  readonly values: readonly unknown[];
  /** Where the call is in the expression. */
  readonly span: SourceSpan;
}

/**
 * Functions the host supplies for one evaluation
 * ([T0021: host hooks](https://github.com/losol/callis/blob/main/docs/tasks/T0021-hooks-async.md#host-hooks)).
 * T0021 adds the others.
 */
export interface EvaluationHooks {
  /**
   * Receives the output of `trace()`, in evaluation order; without it, `trace()` only returns its
   * input. It may return a promise in `evaluateAsync()`, which the evaluation waits for; in
   * `evaluate()` a promise raises `eval/async-in-sync`. An error it throws ends the evaluation.
   *
   * The T0021 sketch returns `void`; this extends it with the sync/async rule of every host hook
   * ([ADR-0004](https://github.com/losol/callis/blob/main/docs/adr/0004-sync-core-async-path.md),
   * [#185](https://github.com/losol/callis/issues/185)).
   */
  trace?(event: TraceEvent): void | PromiseLike<void>;
}

/** Options for one evaluation. */
export interface EvaluateOptions extends OutputOptions {
  /**
   * User variables, by name without the `%`: JSON values, nodes, value classes or arrays.
   * `context` and `ucum` cannot be redefined. A variable named like a FHIR variable (`resource`,
   * `sct`, …) hides it; the `resource` and `rootResource` options are the way to set those two.
   */
  readonly variables?: Readonly<Record<string, unknown>>;
  /**
   * The value of `%resource`, the resource the input is part of
   * ([R5 §2.1.9.1.4](https://hl7.org/fhir/R5/fhirpath.html#variables)), converted like a variable;
   * `null` and `[]` make it empty. By default it is the input when it is a resource, or for an
   * input node, the nearest resource it was navigated from; otherwise the input itself.
   */
  readonly resource?: unknown;
  /**
   * The value of `%rootResource`, the resource that contains `%resource`, converted like a
   * variable; `null` and `[]` make it empty. By default it is the container of `%resource` when
   * that is a contained resource, and otherwise `%resource` itself.
   */
  readonly rootResource?: unknown;
  /** Functions the host supplies, such as the `trace` hook; none by default. */
  readonly hooks?: EvaluationHooks;
  /** The current time for `now()`, `today()` and `timeOfDay()`; the clock by default. */
  readonly now?: Date | (() => Date);
  /**
   * Minutes east of UTC assumed for date/time values without an offset, or `'local'` for the
   * host's offset; 0 (UTC) by default ([ADR-0012](https://github.com/losol/callis/blob/main/docs/adr/0012-evaluation-defaults.md)).
   */
  readonly timezoneOffset?: number | 'local';
  /** Bounds on the work of the evaluation; see {@link EvaluationLimits} for the defaults. */
  readonly limits?: EvaluationLimits;
}

/**
 * Bounds on the work of one evaluation
 * ([architecture: security and robustness](https://github.com/losol/callis/blob/main/docs/architecture.md#security-and-robustness)).
 * Exceeding one raises `eval/limit-exceeded`. Each is a positive integer; a limit left out has
 * its default.
 */
export interface EvaluationLimits {
  /**
   * The most items one `repeat()` call may produce; {@link DEFAULT_LIMITS} by default. `repeat()`
   * ends on data, but a projection that makes new values, such as `'x'.repeat($this & 'x')`,
   * would not end without it.
   */
  readonly maxRepeatItems?: number;
}

/** The default {@link EvaluationLimits}. */
export const DEFAULT_LIMITS: Limits = Object.freeze({
  // repeat() compares each new item with every earlier one, so a tree of this size already takes
  // seconds; a projection that makes new values stops within a fraction of a second.
  maxRepeatItems: 5_000,
});

/** A compiled expression. It holds no evaluation state, so it can be evaluated concurrently. */
export interface CompiledExpression {
  /** The expression text. */
  readonly expression: string;
  /** The parsed expression. */
  readonly ast: ExpressionNode;
  /**
   * Evaluates the expression synchronously.
   *
   * @throws {@link FhirPathEvaluationError} `eval/async-in-sync` when a hook or function returns
   *   a promise; use {@link CompiledExpression.evaluateAsync} for those.
   */
  evaluate(input: unknown, options?: EvaluateOptions): unknown[];
  /** Evaluates the expression, allowing hooks and functions that return promises. */
  evaluateAsync(input: unknown, options?: EvaluateOptions): Promise<unknown[]>;
}

const DEFAULT_REGISTRY: FunctionRegistry = createRegistry();

/**
 * Compiles an expression once, for any number of evaluations.
 *
 * @throws {@link FhirPathSyntaxError} for invalid syntax.
 * @throws {@link FhirPathSemanticError} for an unknown function, a wrong number of arguments or a
 *   type argument that is not a type name.
 */
export function compile(expression: string, options: CompileOptions = {}): CompiledExpression {
  const ast = parse(expression);
  const model = options.model;
  const units = options.units ?? minimalUnitSystem;
  const root = compileExpression(ast, {
    registry: options.functions ?? DEFAULT_REGISTRY,
    model,
    expression,
  });
  const environment: Environment = {
    root,
    model,
    units,
    lenientChoiceSuffix: options.lenient?.choiceSuffix === true,
  };
  return Object.freeze({
    expression,
    ast,
    evaluate(input: unknown, evaluateOptions: EvaluateOptions = {}): unknown[] {
      return requireSync(run(environment, input, evaluateOptions, false));
    },
    async evaluateAsync(input: unknown, evaluateOptions: EvaluateOptions = {}): Promise<unknown[]> {
      return run(environment, input, evaluateOptions, true);
    },
  });
}

/** Compiles and evaluates an expression synchronously. */
export function evaluate(
  input: unknown,
  expression: string,
  options: CompileOptions & EvaluateOptions = {},
): unknown[] {
  return compile(expression, options).evaluate(input, options);
}

/** Compiles and evaluates an expression, allowing async hooks and functions. */
export function evaluateAsync(
  input: unknown,
  expression: string,
  options: CompileOptions & EvaluateOptions = {},
): Promise<unknown[]> {
  // Compile errors become rejections, like evaluation errors.
  return Promise.resolve().then(() => compile(expression, options).evaluateAsync(input, options));
}

interface Environment {
  readonly root: Evaluator;
  readonly model: ModelProvider | undefined;
  readonly units: UnitSystem;
  readonly lenientChoiceSuffix: boolean;
}

function run(
  environment: Environment,
  input: unknown,
  options: EvaluateOptions,
  isAsync: boolean,
): MaybePromise<unknown[]> {
  const ctx = createContext(environment, input, options, isAsync);
  return andThen(environment.root(ctx, ctx.context, rootFrame(ctx.context)), (items) =>
    toOutput(items, options),
  );
}

function createContext(
  environment: Environment,
  input: unknown,
  options: EvaluateOptions,
  isAsync: boolean,
): EvalContext {
  const clock = options.now;
  if (clock !== undefined && !(clock instanceof Date) && typeof clock !== 'function') {
    throw new FhirPathEvaluationError(
      'eval/invalid-argument',
      'Expected the now option to be a Date or a function that returns one',
    );
  }
  let instant: Date | undefined;
  const readClock = (): Date => {
    instant ??= clock === undefined ? new Date() : clock instanceof Date ? clock : clock();
    return instant;
  };
  // The host's offset depends on the date, so 'local' is read at the evaluation's instant.
  const timezoneOffset = resolveTimezoneOffset(
    options.timezoneOffset,
    options.timezoneOffset === 'local' ? readClock() : EPOCH,
  );
  let snapshot: NowSnapshot | undefined;
  const model = environment.model;
  const context = toInputCollection(input, '', model);
  return {
    isAsync,
    context,
    variables: createVariables(options.variables, model),
    environment: createFhirEnvironment(context, options, model),
    modelEquivalence: fhirEquivalence,
    model,
    lenientChoiceSuffix: environment.lenientChoiceSuffix,
    units: environment.units,
    timezoneOffset,
    now(): NowSnapshot {
      snapshot ??= takeNowSnapshot(readClock(), timezoneOffset);
      return snapshot;
    },
    trace: traceSink(options, isAsync),
    limits: resolveLimits(options.limits),
  };
}

/**
 * The limits of an evaluation: the `limits` option with the defaults filled in.
 *
 * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` when the option is not an object
 *   or a limit is not a positive integer.
 */
function resolveLimits(limits: EvaluationLimits | undefined): Limits {
  if (limits === undefined) {
    return DEFAULT_LIMITS;
  }
  if (typeof limits !== 'object' || limits === null) {
    throw new FhirPathEvaluationError('eval/invalid-argument', 'Expected limits to be an object');
  }
  const maxRepeatItems =
    limits.maxRepeatItems === undefined ? DEFAULT_LIMITS.maxRepeatItems : limits.maxRepeatItems;
  if (!Number.isSafeInteger(maxRepeatItems) || maxRepeatItems < 1) {
    throw new FhirPathEvaluationError(
      'eval/invalid-argument',
      'Expected limits.maxRepeatItems to be a positive integer',
    );
  }
  return { maxRepeatItems };
}

/** The sink for `trace()`: the host's `trace` hook, with the items converted like a result. */
function traceSink(options: EvaluateOptions, isAsync: boolean): TraceSink | undefined {
  const hooks = options.hooks;
  if (hooks === undefined) {
    return undefined;
  }
  if (typeof hooks !== 'object' || hooks === null) {
    throw new FhirPathEvaluationError('eval/invalid-argument', 'Expected hooks to be an object');
  }
  const trace = hooks.trace;
  if (trace === undefined) {
    return undefined;
  }
  if (typeof trace !== 'function') {
    throw new FhirPathEvaluationError(
      'eval/invalid-argument',
      'Expected the trace hook to be a function',
    );
  }
  return (name, items, span) =>
    // A host boundary: a thenable is adopted in async mode and rejected in sync mode.
    adoptResult(trace.call(hooks, { name, values: toOutput(items, options), span }), isAsync);
}

/** Only used where `resolveTimezoneOffset()` does not read the instant. */
const EPOCH = new Date(0);
