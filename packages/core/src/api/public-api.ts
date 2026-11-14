/**
 * The synchronous public facade: it validates the options and passes them to the internal API.
 * Internal consumers use api/compile.ts directly.
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import type { ModelProvider } from '../model/model-provider.ts';
import { requireSync } from '../runtime/maybe-promise.ts';
import type { UnitSystem } from '../values/quantity/unit-system.ts';
import {
  type AnalysisResult,
  analyze as analyzeInternal,
  compile as compileInternal,
  type CompileOptions as InternalCompileOptions,
  type EvaluateOptions as InternalEvaluateOptions,
  type LenientOptions,
} from './compile.ts';

export type { AnalysisResult, LenientOptions } from './compile.ts';

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
   * (`['Period', 'Timing']`), for model-aware analysis: an element the type does not have, a
   * leading type name that does not match, and in strict mode an element that may repeat where
   * one item is expected, are reported when the expression is compiled. A name the model does not
   * define is a `semantic/unknown-type` error. Needs `model`.
   */
  readonly inputType?: string | readonly string[];
  /**
   * Compatibility relaxations of the spec's rules; none by default. `choiceSuffix: true` accepts
   * a choice element written with its type suffix (`Observation.valueQuantity`), as other engines
   * do, where the spec's form is `Observation.value.ofType(Quantity)`.
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

/** Options read independently for each synchronous evaluation. */
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
}

/** A reusable synchronous expression with no retained per-evaluation state. */
export interface CompiledExpression {
  /** The original FHIRPath source text. */
  readonly expression: string;
  /**
   * Returns a fresh plain result array. Input objects are returned by reference, without
   * internal navigation wrappers; treat them as read-only. Empty results are `[]`.
   * @throws {@link FhirPathEvaluationError} when evaluation fails.
   */
  evaluate(input: unknown, options?: EvaluateOptions): unknown[];
}

/**
 * Analyzes FHIRPath without compiling it, for editors and other tooling: every problem that
 * {@link compile} throws, plus warnings, as diagnostics in source order. A syntax error is a
 * diagnostic too, with its `syntax/…` code. Errors are what `compile()` rejects; warnings
 * (`semantic/unknown-type` for a type that does not resolve, `semantic/fraction-ignored` when
 * date/time arithmetic ignores part of a quantity) leave the expression valid.
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
  });
}

/**
 * Compiles and evaluates FHIRPath synchronously, without a compile cache.
 * Dates/times are FHIR strings; quantities have `{ value, unit, system?, code? }` shape.
 * Use `decimalOutput: 'string'` for exact Decimal text suitable for JSON serialization.
 * Errors propagate synchronously, including errors from a supplied unit provider.
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

const COMPILE_OPTION_KEYS: readonly string[] = ['model', 'inputType', 'lenient', 'units', 'strict'];

const EVALUATE_OPTION_KEYS: readonly string[] = [
  'variables',
  'resource',
  'rootResource',
  'timezoneOffset',
  'decimalOutput',
];

const LENIENT_OPTION_KEYS: readonly string[] = ['choiceSuffix'];

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
      `Expected the model namespace to be a name other than System, not ${JSON.stringify(namespace)}`,
    );
  }
  return model;
}

/**
 * The `inputType` option: a type name or an array of them. An array is copied, so analysis reads
 * exactly the names that were checked, even from an array whose elements change when read.
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
  if (!names.every((name) => typeof name === 'string')) {
    throw invalid('Expected inputType to be a type name or an array of type names');
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
  return {
    output: 'plain',
    ...(variables === undefined ? {} : { variables }),
    ...(resource === undefined ? {} : { resource }),
    ...(rootResource === undefined ? {} : { rootResource }),
    ...(timezoneOffset === undefined ? {} : { timezoneOffset }),
    ...(decimalOutput === undefined ? {} : { decimalOutput }),
  };
}

function invalid(message: string): FhirPathEvaluationError {
  return new FhirPathEvaluationError('eval/invalid-argument', message);
}
