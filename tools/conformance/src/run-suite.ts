/**
 * Runs suite tests through an {@link EvaluatorAdapter} and judges the outcome. Never throws for a
 * single test: every test ends as passed, failed or skipped with a reason.
 */
import type {
  ClassifiedError,
  ErrorKind,
  EvaluationOptions,
  EvaluatorAdapter,
  ResultItem,
} from './adapter.ts';
import { type Classification, classifyTest } from './classify.ts';
import { formatActual, formatExpected, outputsMatch, toPredicate } from './compare.ts';
import { findException, SUITE_EXCEPTIONS, type SuiteException } from './exceptions.ts';
import { type InputLookup, type InputReader, readFixtureInput } from './fixtures.ts';
import {
  allTests,
  type InvalidKind,
  type SuiteId,
  type SuiteTest,
  type TestSuite,
} from './suite.ts';

/** The outcome of one test. */
export type TestStatus = 'pass' | 'fail' | 'skip';

/** Why a test failed. */
export type FailureKind =
  /** The adapter reported "not implemented". */
  | 'not-implemented'
  /** The result differs from the expected outputs. */
  | 'wrong-output'
  /** The test expects an error, but the evaluation returned a result. */
  | 'missing-error'
  /** The test expects a different kind of error. */
  | 'wrong-error'
  /** The test expects a result, but the evaluation raised an error. */
  | 'unexpected-error'
  /** The input or the adapter itself failed, for example invalid JSON. */
  | 'runner-error';

/** Details of a failed test. */
export interface Failure {
  readonly kind: FailureKind;
  readonly message: string;
  /** For `wrong-output`: the expected outputs, formatted for diffs. */
  readonly expected?: readonly string[];
  /** For `wrong-output`: the actual result, formatted like `expected`. */
  readonly actual?: readonly string[];
}

/** The result of one test. */
export interface TestResult {
  readonly suite: SuiteId;
  readonly test: SuiteTest;
  readonly classification: Classification;
  readonly status: TestStatus;
  /** Why the test was skipped. */
  readonly skipReason: string | undefined;
  readonly failure: Failure | undefined;
  /**
   * An `invalid="semantic"` test that passed because evaluation raised an evaluation error. N1 §11
   * leaves compile-time versus run-time checking to the implementation.
   */
  readonly detectedLate: boolean;
}

/** The results of one suite file. */
export interface SuiteRun {
  readonly suite: TestSuite;
  /** The adapter's name. */
  readonly adapter: string;
  /** One result per test, in document order. */
  readonly results: readonly TestResult[];
}

/** Whether a test runs, decided without evaluating it. */
export type TestPlan =
  | {
      readonly kind: 'run';
      readonly classification: Classification;
      /** The input file's text, or undefined when the test has no input. */
      readonly inputText: string | undefined;
      readonly inputPath: string | undefined;
    }
  | { readonly kind: 'skip'; readonly classification: Classification; readonly reason: string };

/** How to run tests. */
export interface RunnerOptions {
  readonly adapter: EvaluatorAdapter;
  /** Finds input files. Defaults to the vendored fixtures. */
  readonly readInput?: InputReader;
  /** Defaults to {@link SUITE_EXCEPTIONS}. */
  readonly exceptions?: readonly SuiteException[];
}

/** Runs tests with one adapter. Inputs are read and parsed once, and shared between tests. */
export interface Runner {
  /** Decides whether a test runs, and finds its input. */
  plan(suite: SuiteId, test: SuiteTest): TestPlan;
  /** Runs one test. */
  runTest(suite: SuiteId, test: SuiteTest): Promise<TestResult>;
  /** Runs every test of a suite, one after the other. */
  runSuite(suite: TestSuite): Promise<SuiteRun>;
}

/** The errors each `invalid` value accepts. */
const ACCEPTED_ERRORS: Readonly<Record<InvalidKind, readonly ErrorKind[]>> = {
  syntax: ['syntax'],
  semantic: ['semantic', 'execution'],
  execution: ['execution'],
  true: ['syntax', 'semantic', 'execution'],
};

/** Creates a runner. */
export function createRunner(options: RunnerOptions): Runner {
  const { adapter } = options;
  const readInput = options.readInput ?? readFixtureInput;
  const exceptions = options.exceptions ?? SUITE_EXCEPTIONS;
  const lookups = new Map<string, InputLookup>();
  const inputs = new Map<string, { readonly value: unknown } | { readonly error: string }>();

  const lookupInput = (suite: SuiteId, inputFile: string): InputLookup => {
    const key = `${suite}/${inputFile}`;
    let lookup = lookups.get(key);
    if (lookup === undefined) {
      lookup = readInput(suite, inputFile);
      lookups.set(key, lookup);
    }
    return lookup;
  };

  const plan = (suite: SuiteId, test: SuiteTest): TestPlan => {
    const classification = classifyTest(test);
    const exception = findException(exceptions, suite, test.id);
    if (exception !== undefined) {
      const reason = `exception: ${exception.reason} (spec-notes#${exception.note})`;
      return { kind: 'skip', classification, reason };
    }
    if (classification.phase === 'unsupported') {
      return { kind: 'skip', classification, reason: classification.reason ?? 'unsupported' };
    }
    if (test.inputFile === undefined) {
      return { kind: 'run', classification, inputText: undefined, inputPath: undefined };
    }
    const lookup = lookupInput(suite, test.inputFile);
    if (lookup.kind === 'skip') {
      return { kind: 'skip', classification, reason: lookup.reason };
    }
    return { kind: 'run', classification, inputText: lookup.text, inputPath: lookup.path };
  };

  const parseInput = (path: string, text: string) => {
    let entry = inputs.get(path);
    if (entry === undefined) {
      try {
        entry = {
          value: adapter.parseInput === undefined ? JSON.parse(text) : adapter.parseInput(text),
        };
      } catch (error) {
        entry = { error: `could not parse input ${path}: ${messageOf(error)}` };
      }
      inputs.set(path, entry);
    }
    return entry;
  };

  const runTest = async (suite: SuiteId, test: SuiteTest): Promise<TestResult> => {
    const testPlan = plan(suite, test);
    const base = { suite, test, classification: testPlan.classification };
    if (testPlan.kind === 'skip') {
      return {
        ...base,
        status: 'skip',
        skipReason: testPlan.reason,
        failure: undefined,
        detectedLate: false,
      };
    }
    const fail = (failure: Failure): TestResult => ({
      ...base,
      status: 'fail',
      skipReason: undefined,
      failure,
      detectedLate: false,
    });
    const pass = (detectedLate: boolean): TestResult => ({
      ...base,
      status: 'pass',
      skipReason: undefined,
      failure: undefined,
      detectedLate,
    });

    let input: unknown;
    if (testPlan.inputPath !== undefined && testPlan.inputText !== undefined) {
      const parsed = parseInput(testPlan.inputPath, testPlan.inputText);
      if ('error' in parsed) {
        return fail({ kind: 'runner-error', message: parsed.error });
      }
      input = parsed.value;
    }

    let raw: unknown;
    try {
      raw = await adapter.evaluate(input, test.expression, evaluationOptions(suite, test));
    } catch (thrown) {
      const error = classify(adapter, thrown);
      const verdict = judgeError(test.invalid, error);
      return verdict === 'pass' || verdict === 'late' ? pass(verdict === 'late') : fail(verdict);
    }

    if (!Array.isArray(raw)) {
      return fail({ kind: 'runner-error', message: 'the adapter did not return an array' });
    }
    if (test.invalid !== undefined) {
      return fail({
        kind: 'missing-error',
        message: `expected ${errorName(test.invalid)}, got a result with ${raw.length} item(s)`,
      });
    }
    let items: ResultItem[];
    try {
      items = raw.map((value: unknown) => adapter.describeValue(value));
    } catch (error) {
      return fail({ kind: 'runner-error', message: `describeValue failed: ${messageOf(error)}` });
    }
    const actual = test.predicate ? toPredicate(items) : items;
    if (outputsMatch(test.outputs, actual, test.ordered !== false)) {
      return pass(false);
    }
    const expected = test.outputs.map(formatExpected);
    const formatted = actual.map(formatActual);
    return fail({
      kind: 'wrong-output',
      message: `expected [${expected.join(', ')}], got [${formatted.join(', ')}]`,
      expected,
      actual: formatted,
    });
  };

  const runSuite = async (suite: TestSuite): Promise<SuiteRun> => {
    const results: TestResult[] = [];
    for (const test of allTests(suite)) {
      results.push(await runTest(suite.id, test));
    }
    return { suite, adapter: adapter.name, results };
  };

  return { plan, runTest, runSuite };
}

/** The options the adapter gets for a test. */
export function evaluationOptions(suite: SuiteId, test: SuiteTest): EvaluationOptions {
  return {
    fhirVersion: suite,
    testId: test.id,
    inputFile: test.inputFile,
    context: test.context,
    contextTypes: test.contextTypes,
    mode: test.mode,
    strict: test.mode === 'strict',
    lenientChoiceSuffix: test.mode === 'lenient' || test.mode === 'lenient/polymorphics',
    checkOrderedFunctions: test.checkOrderedFunctions,
    skipStaticCheck: test.skipStaticCheck,
  };
}

/** Whether an error satisfies the test: `pass`, `late` (a semantic error found late) or a failure. */
function judgeError(
  invalid: InvalidKind | undefined,
  error: ClassifiedError,
): 'pass' | 'late' | Failure {
  const description = describeError(error);
  if (error.kind === 'not-implemented') {
    return { kind: 'not-implemented', message: `not implemented: ${error.message}` };
  }
  if (invalid === undefined) {
    return { kind: 'unexpected-error', message: `unexpected ${description}` };
  }
  if (!ACCEPTED_ERRORS[invalid].includes(error.kind)) {
    return { kind: 'wrong-error', message: `expected ${errorName(invalid)}, got ${description}` };
  }
  return invalid === 'semantic' && error.kind === 'execution' ? 'late' : 'pass';
}

function classify(adapter: EvaluatorAdapter, thrown: unknown): ClassifiedError {
  try {
    return adapter.classifyError(thrown);
  } catch (error) {
    return { kind: 'other', code: undefined, message: `classifyError failed: ${messageOf(error)}` };
  }
}

function describeError(error: ClassifiedError): string {
  const name = error.kind === 'other' ? 'non-FHIRPath error' : `${error.kind} error`;
  const code = error.code === undefined ? '' : ` [${error.code}]`;
  return `${name}${code}: ${error.message}`;
}

function errorName(invalid: InvalidKind): string {
  return invalid === 'true' ? 'an error' : `a ${invalid} error`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
