/**
 * The internal compile and evaluate API ([T0008](https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md)).
 * The conformance runner's adapter uses it. T0025 builds the public API on it, with option
 * validation, the compile cache and the final output adapters
 * ([T0025: public API sketch](https://github.com/losol/callis/blob/main/docs/tasks/T0025-public-api-release.md#public-api-sketch)).
 */
import { compileExpression } from '../compiler/compile.ts';
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { createRegistry, type FunctionRegistry } from '../functions/registry.ts';
import type { ModelProvider } from '../model/model-provider.ts';
import type { ExpressionNode } from '../parser/ast.ts';
import { parse } from '../parser/parser.ts';
import { type EvalContext, type Evaluator, rootFrame } from '../runtime/context.ts';
import { andThen, type MaybePromise, requireSync } from '../runtime/maybe-promise.ts';
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

/** Options for one evaluation. */
export interface EvaluateOptions extends OutputOptions {
  /** User variables, by name without the `%`: JSON values, nodes, value classes or arrays. */
  readonly variables?: Readonly<Record<string, unknown>>;
  /** The current time for `now()`, `today()` and `timeOfDay()`; the clock by default. */
  readonly now?: Date | (() => Date);
  /**
   * Minutes east of UTC assumed for date/time values without an offset, or `'local'` for the
   * host's offset; 0 (UTC) by default ([ADR-0012](https://github.com/losol/callis/blob/main/docs/adr/0012-evaluation-defaults.md)).
   */
  readonly timezoneOffset?: number | 'local';
}

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
  return {
    isAsync,
    context: toInputCollection(input, '', model),
    variables: createVariables(options.variables, model),
    model,
    lenientChoiceSuffix: environment.lenientChoiceSuffix,
    units: environment.units,
    timezoneOffset,
    now(): NowSnapshot {
      snapshot ??= takeNowSnapshot(readClock(), timezoneOffset);
      return snapshot;
    },
  };
}

/** Only used where `resolveTimezoneOffset()` does not read the instant. */
const EPOCH = new Date(0);
