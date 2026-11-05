/**
 * The interface between the conformance runner and an evaluator.
 *
 * The runner never imports `@callis/core`. It calls an {@link EvaluatorAdapter}, so the engine can
 * be plugged in without changing the runner: today the stub in `stub-adapter.ts`, from T0008 the
 * engine's internal `compile()`/`evaluate()`, and from T0025 the public API. Which adapter the CLI
 * and the Vitest project use is decided in `engine-adapter.ts`.
 */
import type { SuiteId } from './suite.ts';

/** How a test asks to be evaluated. Everything here comes from the test file. */
export interface EvaluationOptions {
  /** The suite file, which also selects the FHIR model: R4 or R5. */
  readonly fhirVersion: SuiteId;
  /** The suite test ID, for diagnostics only. */
  readonly testId: string;
  /** The input file the input came from, if any. */
  readonly inputFile: string | undefined;
  /**
   * When set, evaluate this expression on the input first; it selects exactly one node, and
   * `expression` is evaluated with that node as its focus (`context` in the test file).
   * `%resource` and `%rootResource` stay the whole input.
   */
  readonly context: string | undefined;
  /**
   * The declared type(s) of the focus for static analysis (`contextType`, for example
   * `['Period', 'Timing']`). Empty when not given.
   */
  readonly contextTypes: readonly string[];
  /** The raw `mode` of the test or its group, for example `element` or `html`. */
  readonly mode: string | undefined;
  /** N1 §11 strict evaluation (`mode="strict"`). */
  readonly strict: boolean;
  /**
   * Accept choice-type suffixes such as `Observation.valueQuantity`
   * (`mode="lenient/polymorphics"`; ADR-0012).
   */
  readonly lenientChoiceSuffix: boolean;
  /** Evaluate without static analysis (`skipStaticCheck="true"`). */
  readonly skipStaticCheck: boolean;
}

/**
 * One result item as the runner compares it. The adapter converts its own values into this form.
 *
 * @example
 * ```ts
 * { type: 'System.Decimal', value: '1.50' }
 * { type: 'FHIR.code', value: 'male' }
 * { type: 'System.Date', value: '2014-01-01' }          // no '@'
 * { type: 'System.Time', value: '10:30:00.000' }        // no '@T'
 * { type: 'System.Quantity', value: '1.5', unit: 'cm' } // unit without quotes
 * { type: 'FHIR.HumanName' }                            // not a primitive: no value
 * ```
 */
export interface ResultItem {
  /** The qualified type name, for example `System.Integer`, `FHIR.code` or `FHIR.Patient`. */
  readonly type: string;
  /**
   * For primitives and quantities, the value as text, keeping precision: Booleans as `true` or
   * `false`, numbers as plain decimal text (no exponent), dates and times in FHIR format without
   * `@` or `T` prefixes. Undefined for other values.
   */
  readonly value?: string;
  /**
   * For quantities, the unit as a quantity literal writes it, without quotes: a UCUM code such as
   * `cm`, or a calendar duration word such as `days`. A `FHIR.Quantity` reports its UCUM `code`,
   * not its free-text `unit`. The runner compares it exactly with the unit in the expected output.
   */
  readonly unit?: string;
}

/** What kind of error an evaluation raised. */
export type ErrorKind =
  /** `FhirPathSyntaxError`. */
  | 'syntax'
  /** `FhirPathSemanticError`. */
  | 'semantic'
  /** `FhirPathEvaluationError`. */
  | 'execution'
  /** The adapter or engine does not support this yet. The test fails, whatever it expects. */
  | 'not-implemented'
  /** Anything else, for example a `TypeError` from a bug. Never satisfies `invalid`. */
  | 'other';

/** An error raised by {@link EvaluatorAdapter.evaluate}, classified by the adapter. */
export interface ClassifiedError {
  readonly kind: ErrorKind;
  /** The engine's stable error code, for example `eval/singleton-expected`. */
  readonly code: string | undefined;
  readonly message: string;
}

/** A collection, or a promise of one for async evaluation. */
export type MaybePromise<T> = T | PromiseLike<T>;

/**
 * Plugs an evaluator into the runner.
 *
 * Contract:
 * - {@link evaluate} returns the result collection or throws. The runner awaits the result, so an
 *   async evaluator can return a promise.
 * - Every error thrown by {@link evaluate} is passed to {@link classifyError}, which maps the
 *   engine's error classes to {@link ErrorKind}. Errors are part of the contract, not crashes.
 * - Every result item is passed to {@link describeValue} before it is compared.
 * - Adapters must be stateless between calls: tests run in any order, and inputs are shared.
 */
export interface EvaluatorAdapter {
  /** Shown in reports, for example `stub` or `@callis/core (internal API)`. */
  readonly name: string;
  /**
   * Parses the text of a JSON input file. Optional; the default is `JSON.parse`. An engine that
   * keeps decimal precision passes its lossless JSON parser here (T0018). Each file is parsed
   * once per run and the result is shared by every test that uses it, so evaluation must not
   * mutate it.
   */
  parseInput?(text: string): unknown;
  /**
   * Evaluates `expression` against `input`.
   *
   * @param input The parsed input file, or `undefined` when the test has none.
   */
  evaluate(
    input: unknown,
    expression: string,
    options: EvaluationOptions,
  ): MaybePromise<readonly unknown[]>;
  /** Converts one item of an evaluation result for comparison. */
  describeValue(value: unknown): ResultItem;
  /** Classifies an error thrown by {@link evaluate}. */
  classifyError(error: unknown): ClassifiedError;
}
