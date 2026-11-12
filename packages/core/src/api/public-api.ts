/** The small synchronous, model-less facade. Internal consumers use api/compile.ts directly. */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { requireSync } from '../runtime/maybe-promise.ts';
import type { UnitSystem } from '../values/quantity/unit-system.ts';
import {
  type AnalysisResult,
  analyze as analyzeInternal,
  compile as compileInternal,
  type CompileOptions as InternalCompileOptions,
  type EvaluateOptions as InternalEvaluateOptions,
} from './compile.ts';

export type { AnalysisResult } from './compile.ts';

/** Options fixed for the lifetime of a compiled expression. */
export interface CompileOptions {
  /** Pure synchronous unit provider; defaults to the minimal built-in unit system. */
  readonly units?: UnitSystem;
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
 * Analyzes model-less FHIRPath without compiling it, for editors and other tooling: every
 * problem that {@link compile} throws, plus warnings, as diagnostics in source order. A syntax
 * error is a diagnostic too, with its `syntax/…` code. Errors are what `compile()` rejects;
 * warnings (`semantic/unknown-type` for a type that does not resolve, `semantic/fraction-ignored`
 * when date/time arithmetic ignores part of a quantity) leave the expression valid.
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
 * Compiles model-less FHIRPath for repeated synchronous evaluation.
 * Only the currently implemented operators and built-in functions are available.
 * @throws {@link FhirPathSyntaxError} for invalid syntax.
 * @throws {@link FhirPathSemanticError} for what static analysis rejects, with every diagnostic
 *   in `diagnostics`: an unknown function, a wrong number of arguments, a type argument that is
 *   not a type name, and an input or argument of a type the function never accepts (`'a'.abs()`).
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
 * Compiles and evaluates model-less FHIRPath synchronously, without a compile cache.
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

const COMPILE_OPTION_KEYS: readonly string[] = ['units'];

const EVALUATE_OPTION_KEYS: readonly string[] = [
  'variables',
  'resource',
  'rootResource',
  'timezoneOffset',
  'decimalOutput',
];

function checkExpression(expression: unknown): asserts expression is string {
  if (typeof expression !== 'string') {
    throw invalid('Expected the expression to be a string');
  }
}

function checkOptions(options: unknown, allowed: readonly string[]): asserts options is object {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw invalid('Expected options to be an object');
  }
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== 'string' || !allowed.includes(key)) {
      throw invalid(`Unsupported option: ${String(key)}`);
    }
  }
}

function own<T extends object, K extends keyof T>(options: T, key: K): T[K] | undefined {
  return Object.hasOwn(options, key) ? options[key] : undefined;
}

function compileOptions(options: CompileOptions): InternalCompileOptions {
  const units = own(options, 'units');
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
