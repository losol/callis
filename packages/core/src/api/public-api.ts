/**
 * The public facade: it validates the options and passes them to the internal API, for
 * synchronous evaluation with `evaluate()` and asynchronous evaluation with `evaluateAsync()`.
 * Internal consumers use api/compile.ts directly.
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import type { ModelProvider } from '../model/model-provider.ts';
import type { CancellationSignal } from '../runtime/cancellation.ts';
import type { EvaluationHooks } from '../runtime/hooks.ts';
import { requireSync } from '../runtime/maybe-promise.ts';
import type { UnitSystem } from '../values/quantity/unit-system.ts';
import {
  type AnalysisResult,
  analyze as analyzeInternal,
  compile as compileInternal,
  type EvaluationLimits,
  type CompileOptions as InternalCompileOptions,
  type EvaluateOptions as InternalEvaluateOptions,
  type LenientOptions,
} from './compile.ts';

export type { AnalysisResult, EvaluationLimits, LenientOptions } from './compile.ts';

/** Options fixed for the lifetime of a compiled expression. */
export interface CompileOptions {
  /**
   * The data model, such as `r4` from `@callis/fhir-r4`, `r5` or `r6`. With a model, navigation
   * is type-directed: a choice element is reached by its name (`Observation.value`), a FHIR
   * primitive keeps its extensions, FHIR primitives compare as System values, and `is`, `as` and
   * `ofType()` know the model's types and their inheritance. Without one, plain JSON is navigated
   * by its keys. Its `namespace` must not be empty or `System`.
   * @see https://hl7.org/fhirpath/N1/#models
   * @see https://hl7.org/fhir/R5/fhirpath.html#types
   */
  readonly model?: ModelProvider;
  /**
   * The type of the input by its name in the model (`'Patient'`), or the types it may have
   * (`['Patient', 'Group']`), for model-aware analysis: an element the type does not have, a
   * leading type name that does not match, and in strict mode an element that may repeat where
   * one item is expected, are reported when the expression is compiled. A name the model does not
   * define is a `semantic/unknown-type` error. Needs `model`, and at least one name.
   *
   * Evaluation uses it too, so the two agree. With one type name, an input that does not say its
   * type is evaluated as a value of that type: an object without its own `resourceType`, such as
   * a bare `Period`, when the name is a resource, complex or backbone type, and a JSON string,
   * number or boolean when it is a primitive type. Its FHIR primitives, choice elements and
   * extensions are then found as in a resource, and `is`, `as` and `ofType()` see the type. Each
   * item of an array input is typed the same way. An input that says its own type (a resource's
   * `resourceType`) keeps it, even when `inputType` names another: analysis never sees the input,
   * so that conflict is not reported. With several names, the input stays untyped.
   * @see https://hl7.org/fhir/R5/fhirpath.html#types
   * @example
   * evaluate({ start: '2020-01-01' }, 'start > @2019', { model: r4, inputType: 'Period' }); // [true]
   */
  readonly inputType?: string | readonly string[];
  /**
   * Compatibility relaxations of the spec's rules; none by default. `choiceSuffix: true` accepts
   * a choice element written with its type suffix (`Observation.valueQuantity`), as other engines
   * do, where the spec's form is `Observation.value.ofType(Quantity)`. Without `model` it has no
   * effect, since plain JSON is navigated by its keys anyway.
   * @see https://github.com/losol/callis/blob/main/docs/adr/0012-evaluation-defaults.md
   */
  readonly lenient?: LenientOptions;
  /** Pure synchronous unit provider; defaults to the minimal built-in unit system. */
  readonly units?: UnitSystem;
  /**
   * Strict evaluation ([N1 §11](https://hl7.org/fhirpath/N1/#type-safety-and-strict-evaluation)):
   * static analysis also rejects, as `FhirPathSemanticError`, a value that may repeat where an
   * operator or function takes a single item (`semantic/singleton-expected`), a value that is
   * not a Boolean where one is expected (`semantic/type-mismatch`), equality between a single
   * item and a collection, and `first()`, `last()`, `tail()`, `skip()`, `take()` or the indexer
   * on `children()` or `descendants()`, whose order is undefined
   * (`semantic/unordered-collection`). Without a model, analysis knows the types of literals,
   * operators and functions, not of the input's elements; with `model` it also knows which
   * elements may repeat, wherever it knows their type (from `inputType` or a leading type name).
   * It changes what compiles, never what an expression evaluates to. Off by default.
   */
  readonly strict?: boolean;
}

/** Options read independently for each evaluation, by `evaluate()` and `evaluateAsync()`. */
export interface EvaluateOptions {
  /**
   * Values keyed by variable name without `%`; only own properties are read. `context` and `ucum`
   * cannot be redefined. A variable named like a FHIR variable (`resource`, `sct`, …) hides it;
   * prefer the `resource` and `rootResource` options, which `resolve()` also uses.
   */
  readonly variables?: Readonly<Record<string, unknown>>;
  /**
   * The value of `%resource`, converted like a variable; `null` and `[]` make it empty. By
   * default `%resource` is the input.
   * @see https://hl7.org/fhir/R5/fhirpath.html#variables
   */
  readonly resource?: unknown;
  /**
   * The value of `%rootResource`, converted like a variable; `null` and `[]` make it empty. By
   * default it is `%resource`: the option's value when given, otherwise the input. `resolve()`
   * looks up the contained references (`#id`) of a contained resource evaluated on its own in it.
   * @see https://hl7.org/fhir/R5/fhirpath.html#variables
   */
  readonly rootResource?: unknown;
  /** Minutes east of UTC, or the host's current offset; defaults to 0 (UTC). */
  readonly timezoneOffset?: number | 'local';
  /**
   * Decimal and Quantity magnitudes become potentially lossy numbers by default.
   * `string` preserves evaluator Decimal digits, but cannot restore rounded input numbers.
   */
  readonly decimalOutput?: 'number' | 'string';
  /**
   * Functions the host supplies for this evaluation, none by default: `resolve`, `terminology`
   * (`memberOf()`, `subsumes()`, `subsumedBy()`), `conformsTo`, `htmlChecks`, `regex` and
   * `trace` ({@link EvaluationHooks}). Without its hook, a function gives empty; `trace()` only
   * returns its input. In `evaluate()` every hook must answer synchronously: a promise, or any
   * other thenable, raises `eval/async-in-sync`. `evaluateAsync()` waits for one from any hook
   * but `regex`. An own property that is not a hook is rejected, so a misspelled hook is never
   * ignored; a hook may also be inherited, as a method of a class. `terminology` is a provider
   * object, like `units`, and may have other properties.
   * @see https://github.com/losol/callis/blob/main/docs/guide.md#async-evaluation-and-hooks
   */
  readonly hooks?: EvaluationHooks;
  /**
   * Stops the evaluation: an aborted signal raises `eval/aborted`, with the signal's `reason` as
   * the error's `cause`. Any `AbortSignal` fits. It is read when the evaluation starts, before
   * each hook call, after each hook result the evaluation waited for and before each item that
   * `repeat()` projects, and every hook gets it in its context, to pass on to `fetch()`. In
   * `evaluate()` nothing else runs while the evaluation does, so only a hook can abort it.
   */
  readonly signal?: CancellationSignal;
  /**
   * In `evaluateAsync()`, the most hook calls a host-backed function such as `resolve()` starts
   * at once for the items of one collection: a positive integer, or `Infinity` for no limit; 8 by
   * default. The results keep the order of the items. `evaluate()` calls one hook at a time,
   * which every value allows, so one options object serves both.
   */
  readonly concurrency?: number;
  /**
   * The current time for `now()`, `today()` and `timeOfDay()`, for repeatable results: a valid
   * `Date`, copied when the evaluation starts, or a function that returns one, called once when
   * the evaluation first needs the time. The host's clock by default.
   */
  readonly now?: Date | (() => Date);
  /**
   * Bounds on the work of the evaluation ({@link EvaluationLimits}): `maxRepeatItems`, 5,000 by
   * default, and `maxCollectionSize`, 1,000,000 by default. A limit left out keeps its default;
   * exceeding one raises `eval/limit-exceeded`.
   */
  readonly limits?: EvaluationLimits;
}

/**
 * A reusable expression with no retained per-evaluation state, so it can be evaluated any number
 * of times, also by overlapping `evaluateAsync()` calls.
 */
export interface CompiledExpression {
  /** The original FHIRPath source text. */
  readonly expression: string;
  /**
   * Returns a fresh plain result array. Input objects are returned by reference, without
   * internal navigation wrappers; treat them as read-only. Empty results are `[]`.
   * @throws {@link FhirPathEvaluationError} when evaluation fails, `eval/async-in-sync` when a
   *   hook returns a promise; use {@link CompiledExpression.evaluateAsync} for those.
   */
  evaluate(input: unknown, options?: EvaluateOptions): unknown[];
  /**
   * Evaluates like {@link CompiledExpression.evaluate}, and waits for hooks that return a promise
   * or any other thenable. Every error, an invalid option too, rejects the promise; nothing is
   * thrown synchronously. The options are read when it is called.
   */
  evaluateAsync(input: unknown, options?: EvaluateOptions): Promise<unknown[]>;
}

/**
 * Analyzes FHIRPath without compiling it, for editors and other tooling: every problem that
 * {@link compile} throws, plus warnings, as diagnostics in source order. A syntax error is a
 * diagnostic too, with its `syntax/…` code. Errors are what `compile()` rejects, including an
 * `inputType` the model does not define (`semantic/unknown-type`); warnings
 * (`semantic/unknown-type` for a type in `is`, `as` or `ofType()` that does not resolve,
 * `semantic/fraction-ignored` when date/time arithmetic ignores part of a quantity) leave the
 * expression valid.
 * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` for unsupported options.
 * @example
 * analyze('@2020-01-01 + 1.5 days').diagnostics; // [{ severity: 'warning', code: 'semantic/fraction-ignored', … }]
 * analyze("1 + 'a'").diagnostics[0]?.severity;     // 'warning'
 */
export function analyze(expression: string, options: CompileOptions = {}): AnalysisResult {
  checkExpression(expression);
  checkOptions(options, COMPILE_OPTION_KEYS);
  return analyzeInternal(expression, compileOptions(options));
}

/**
 * Compiles FHIRPath for repeated synchronous evaluation, on plain JSON or with a `model`.
 * Only the currently implemented operators and built-in functions are available.
 * @throws {@link FhirPathSyntaxError} for invalid syntax.
 * @throws {@link FhirPathSemanticError} for what static analysis rejects, with every diagnostic
 *   in `diagnostics`: an unknown function, a wrong number of arguments, a type argument that is
 *   not a type name, operands or arguments of a type the operator or function never accepts
 *   (`1 + 'a'`), with `model` and `inputType` an element the input type does not have or an
 *   input type the model does not define, and in strict mode the unsafe uses of N1 §11.
 * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` for unsupported options.
 * @example
 * const names = compile('Patient.name.given');
 * names.evaluate({ resourceType: 'Patient', name: [{ given: ['Ada'] }] }); // ['Ada']
 */
export function compile(expression: string, options: CompileOptions = {}): CompiledExpression {
  checkExpression(expression);
  checkOptions(options, COMPILE_OPTION_KEYS);
  const compiled = compileInternal(expression, compileOptions(options));
  return Object.freeze({
    expression,
    evaluate(input: unknown, options: EvaluateOptions = {}): unknown[] {
      checkOptions(options, EVALUATE_OPTION_KEYS);
      return compiled.evaluate(input, evaluateOptions(options));
    },
    async evaluateAsync(input: unknown, options: EvaluateOptions = {}): Promise<unknown[]> {
      checkOptions(options, EVALUATE_OPTION_KEYS);
      return compiled.evaluateAsync(input, evaluateOptions(options));
    },
  });
}

/**
 * Compiles and evaluates FHIRPath synchronously, without a compile cache.
 * Dates/times are FHIR strings; quantities have `{ value, unit, system?, code? }` shape.
 * Use `decimalOutput: 'string'` for exact Decimal text suitable for JSON serialization.
 * Errors propagate synchronously, including errors from a supplied unit provider or hook. A hook
 * that returns a promise raises `eval/async-in-sync`; use {@link evaluateAsync} for those.
 * @example
 * evaluate(null, '1.2300', { decimalOutput: 'string' }); // ['1.2300']
 */
export function evaluate(
  input: unknown,
  expression: string,
  options: CompileOptions & EvaluateOptions = {},
): unknown[] {
  checkExpression(expression);
  checkOptions(options, [...COMPILE_OPTION_KEYS, ...EVALUATE_OPTION_KEYS]);
  return compileInternal(expression, compileOptions(options)).evaluate(
    input,
    evaluateOptions(options),
  );
}

/**
 * Compiles and evaluates FHIRPath like {@link evaluate}, and waits for hooks that return a promise
 * or any other thenable, such as a `resolve` hook that reads from a server. Syntax, semantic,
 * option and evaluation errors all reject the promise; nothing is thrown synchronously. The
 * options are read when it is called. The hook calls for the items of one collection run at the
 * same time, at most `concurrency` of them, and the results keep the order of the items.
 * @see https://github.com/losol/callis/blob/main/docs/guide.md#async-evaluation-and-hooks
 * @example
 * const names = await evaluateAsync(bundle, 'Bundle.entry.resource.subject.resolve().name', {
 *   model: r4,
 *   hooks: { resolve: (reference, { signal }) => client.read(reference, { signal }) },
 * });
 */
export async function evaluateAsync(
  input: unknown,
  expression: string,
  options: CompileOptions & EvaluateOptions = {},
): Promise<unknown[]> {
  checkExpression(expression);
  checkOptions(options, [...COMPILE_OPTION_KEYS, ...EVALUATE_OPTION_KEYS]);
  return compileInternal(expression, compileOptions(options)).evaluateAsync(
    input,
    evaluateOptions(options),
  );
}

const COMPILE_OPTION_KEYS: readonly string[] = ['model', 'inputType', 'lenient', 'units', 'strict'];

const EVALUATE_OPTION_KEYS: readonly string[] = [
  'variables',
  'resource',
  'rootResource',
  'timezoneOffset',
  'decimalOutput',
  'hooks',
  'signal',
  'concurrency',
  'now',
  'limits',
];

const LENIENT_OPTION_KEYS: readonly string[] = ['choiceSuffix'];

/** The hooks of {@link EvaluationHooks}. */
const HOOK_KEYS: readonly string[] = [
  'resolve',
  'terminology',
  'conformsTo',
  'htmlChecks',
  'regex',
  'trace',
];

/** The limits of {@link EvaluationLimits}. */
const LIMIT_KEYS: readonly string[] = ['maxRepeatItems', 'maxCollectionSize'];

/** The methods of the `ModelProvider` contract. */
const MODEL_METHODS = [
  'getType',
  'getRootType',
  'getElement',
  'getElements',
  'isSubtypeOf',
  'getSystemType',
] as const;

function checkExpression(expression: unknown): asserts expression is string {
  if (typeof expression !== 'string') {
    throw invalid('Expected the expression to be a string');
  }
}

/**
 * Checks that `options` is a plain options object with only the allowed own keys. `name` is the
 * option that holds a nested options object, such as `lenient`.
 */
function checkOptions(
  options: unknown,
  allowed: readonly string[],
  name?: string,
): asserts options is object {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw invalid(`Expected ${name ?? 'options'} to be an object`);
  }
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== 'string' || !allowed.includes(key)) {
      throw invalid(`Unsupported option: ${name === undefined ? '' : `${name}.`}${String(key)}`);
    }
  }
}

function own<T extends object, K extends keyof T>(options: T, key: K): T[K] | undefined {
  return Object.hasOwn(options, key) ? options[key] : undefined;
}

function compileOptions(options: CompileOptions): InternalCompileOptions {
  const strict = own(options, 'strict');
  if (strict !== undefined && typeof strict !== 'boolean') {
    throw invalid('Expected strict to be a boolean');
  }
  const model = checkModel(own(options, 'model'));
  const inputType = checkInputType(own(options, 'inputType'), model);
  const lenient = checkLenient(own(options, 'lenient'));
  return {
    ...(strict === undefined ? {} : { strict }),
    ...(model === undefined ? {} : { model }),
    ...(inputType === undefined ? {} : { inputType }),
    ...(lenient === undefined ? {} : { lenient }),
    ...unitsOption(own(options, 'units')),
  };
}

/**
 * The `model` option, checked to implement the `ModelProvider` contract. The provider is not
 * wrapped: it is synchronous and precomputed by contract, and it runs on the navigation hot path.
 * A `System` namespace would make the model's types look like System types and shadow
 * `System.String` and the others in type specifiers ([#60](https://github.com/losol/callis/issues/60)).
 */
function checkModel(model: ModelProvider | undefined): ModelProvider | undefined {
  if (model === undefined) return undefined;
  if (
    typeof model !== 'object' ||
    model === null ||
    typeof model.version !== 'string' ||
    MODEL_METHODS.some((method) => typeof model[method] !== 'function')
  ) {
    throw invalid('Expected model to implement the ModelProvider contract');
  }
  const namespace: unknown = model.namespace;
  if (typeof namespace !== 'string' || namespace === '' || namespace === 'System') {
    throw invalid(
      `Expected the model namespace to be a name other than System, not ${describe(namespace)}`,
    );
  }
  return model;
}

/**
 * The `inputType` option: a type name or a non-empty array of them. An array is copied, so
 * analysis reads exactly the names that were checked, even from an array whose elements change
 * when read. An empty array is rejected rather than read as no type, so a later meaning for it
 * stays open.
 */
function checkInputType(
  inputType: string | readonly string[] | undefined,
  model: ModelProvider | undefined,
): string | readonly string[] | undefined {
  if (inputType === undefined) return undefined;
  if (model === undefined) {
    throw invalid('The inputType option needs a model');
  }
  if (typeof inputType === 'string') return inputType;
  // Array.from() turns holes into undefined, which the check then rejects.
  const names: unknown[] = Array.isArray(inputType) ? Array.from(inputType) : [undefined];
  if (names.length === 0 || !names.every((name) => typeof name === 'string')) {
    throw invalid('Expected inputType to be a type name or a non-empty array of type names');
  }
  return Object.freeze(names.filter((name) => typeof name === 'string'));
}

/** The `lenient` option, with only the relaxations that exist. */
function checkLenient(lenient: LenientOptions | undefined): LenientOptions | undefined {
  if (lenient === undefined) return undefined;
  checkOptions(lenient, LENIENT_OPTION_KEYS, 'lenient');
  const choiceSuffix = own(lenient, 'choiceSuffix');
  if (choiceSuffix !== undefined && typeof choiceSuffix !== 'boolean') {
    throw invalid('Expected lenient.choiceSuffix to be a boolean');
  }
  return choiceSuffix === undefined ? {} : { choiceSuffix };
}

/** The `units` option, guarded at the host boundary. */
function unitsOption(units: UnitSystem | undefined): { readonly units?: UnitSystem } {
  if (units === undefined) return {};
  if (
    typeof units !== 'object' ||
    units === null ||
    typeof units.parse !== 'function' ||
    typeof units.convert !== 'function' ||
    typeof units.multiply !== 'function' ||
    typeof units.divide !== 'function' ||
    (units.compare !== undefined && typeof units.compare !== 'function')
  ) {
    throw invalid('Expected units to implement the synchronous UnitSystem contract');
  }
  // UnitSystem is synchronous by contract. Guard the host boundary for JavaScript callers too.
  const synchronousUnits: UnitSystem = {
    parse: (unit) => requireSync(units.parse(unit)),
    convert: (value, from, to, options) => requireSync(units.convert(value, from, to, options)),
    multiply: (a, b) => requireSync(units.multiply(a, b)),
    divide: (a, b) => requireSync(units.divide(a, b)),
    ...(units.compare === undefined
      ? {}
      : {
          compare: (a, from, b, to) => requireSync(units.compare?.(a, from, b, to)),
        }),
  };
  return { units: synchronousUnits };
}

function evaluateOptions(options: EvaluateOptions): InternalEvaluateOptions {
  const variables = own(options, 'variables');
  const resource = own(options, 'resource');
  const rootResource = own(options, 'rootResource');
  const timezoneOffset = own(options, 'timezoneOffset');
  const decimalOutput = own(options, 'decimalOutput');
  if (decimalOutput !== undefined && decimalOutput !== 'number' && decimalOutput !== 'string') {
    throw invalid('Expected decimalOutput to be number or string');
  }
  // The internal API checks the signal, the concurrency and each hook and limit value.
  const hooks = checkHooks(own(options, 'hooks'));
  const signal = own(options, 'signal');
  const concurrency = own(options, 'concurrency');
  const now = checkNow(own(options, 'now'));
  const limits = checkLimits(own(options, 'limits'));
  return {
    output: 'plain',
    ...(variables === undefined ? {} : { variables }),
    ...(resource === undefined ? {} : { resource }),
    ...(rootResource === undefined ? {} : { rootResource }),
    ...(timezoneOffset === undefined ? {} : { timezoneOffset }),
    ...(decimalOutput === undefined ? {} : { decimalOutput }),
    ...(hooks === undefined ? {} : { hooks }),
    ...(signal === undefined ? {} : { signal }),
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(now === undefined ? {} : { now }),
    ...(limits === undefined ? {} : { limits }),
  };
}

/**
 * The `hooks` option: an object whose own properties are hooks, so a misspelled or future hook is
 * rejected rather than ignored. It is passed on as it is: the internal API checks that each hook
 * is a function and calls it with the host's object as `this`, and a hook may be inherited, as a
 * method of a class. `terminology` is a provider like `units`, checked for its two members there.
 */
function checkHooks(hooks: EvaluationHooks | undefined): EvaluationHooks | undefined {
  if (hooks === undefined) return undefined;
  checkOptions(hooks, HOOK_KEYS, 'hooks');
  return hooks;
}

/**
 * The `now` option. A `Date`, from any realm, is copied, so a change to it after the call cannot
 * reach an evaluation that has started, and an invalid one is rejected before evaluation. The
 * result of a function is checked the same way, when the evaluation first needs the time; the
 * internal API calls it at most once per evaluation.
 */
function checkNow(now: Date | (() => Date) | undefined): Date | (() => Date) | undefined {
  if (now === undefined) return undefined;
  if (typeof now === 'function') {
    return () => validDate(now(), 'Expected the now option to return a valid Date');
  }
  return validDate(
    now,
    'Expected the now option to be a valid Date or a function that returns one',
  );
}

/**
 * A copy of `value` when it is a valid `Date`. `Date.prototype.getTime()` reads the date of any
 * realm's `Date` and throws a `TypeError` for anything else, where `instanceof` would miss a
 * `Date` from an iframe or `node:vm`.
 */
function validDate(value: unknown, message: string): Date {
  let time: number;
  try {
    time = Date.prototype.getTime.call(value);
  } catch {
    throw invalid(message);
  }
  if (Number.isNaN(time)) {
    throw invalid(message);
  }
  return new Date(time);
}

/** The `limits` option, with only the limits that exist; the internal API checks their values. */
function checkLimits(limits: EvaluationLimits | undefined): EvaluationLimits | undefined {
  if (limits === undefined) return undefined;
  checkOptions(limits, LIMIT_KEYS, 'limits');
  const maxRepeatItems = own(limits, 'maxRepeatItems');
  const maxCollectionSize = own(limits, 'maxCollectionSize');
  return {
    ...(maxRepeatItems === undefined ? {} : { maxRepeatItems }),
    ...(maxCollectionSize === undefined ? {} : { maxCollectionSize }),
  };
}

/**
 * A rejected option value for an error message: a string quoted, any other value by its type.
 * Serializing a value that is not a string can throw (a bigint, a cycle, a throwing `toJSON()`),
 * which would replace the `eval/invalid-argument` error with another one.
 */
function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null || value === undefined) return String(value);
  return `a value of type ${typeof value}`;
}

function invalid(message: string): FhirPathEvaluationError {
  return new FhirPathEvaluationError('eval/invalid-argument', message);
}
