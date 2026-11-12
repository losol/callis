/**
 * Evaluates a suite test as the engine adapter does, but without static analysis, for the tests
 * that compare the analysis with the evaluation
 * ([T0024](../../../docs/tasks/T0024-static-analysis.md)): the context expression selects the
 * focus, the expression gets the suite's model, the fake hooks, the input type and the mode of the
 * test, and `compileUnchecked()` leaves every check to the evaluation.
 */
import { type CompileOptions, compileUnchecked } from '../../../packages/core/src/api/compile.ts';
import { parseJson } from '../../../packages/core/src/model/lossless-json.ts';
import type { EvaluationHooks } from '../../../packages/core/src/runtime/hooks.ts';
import { compileOptionsFor, expressionOptionsFor, hooksFor } from './engine-adapter.ts';
import { readFixtureInput } from './fixtures.ts';
import { evaluationOptions } from './run-suite.ts';
import type { SuiteId, SuiteTest } from './suite.ts';

/** A test's input, parsed; `input` is undefined for a test without an input file. */
export interface SuiteInput {
  readonly input: unknown;
}

/** A test as the adapter evaluates it: the focus, the hooks, and the options of its expression. */
export interface PreparedTest {
  readonly focus: unknown;
  readonly hooks: EvaluationHooks;
  /** The compile options of the expression: the model, the input type and the mode of the test. */
  readonly options: CompileOptions;
}

/** What evaluating an expression without static analysis gave: a result, or what it threw. */
export type UncheckedOutcome =
  | { readonly ok: true; readonly items: readonly unknown[] }
  | { readonly ok: false; readonly error: unknown };

/** Reads and parses the inputs of a suite as the runner does, each file once. */
export function inputReader(suite: SuiteId): (test: SuiteTest) => SuiteInput | undefined {
  const inputs = new Map<string, SuiteInput | undefined>();
  return (test) => {
    if (test.inputFile === undefined) {
      return { input: undefined };
    }
    if (!inputs.has(test.inputFile)) {
      const lookup = readFixtureInput(suite, test.inputFile);
      inputs.set(
        test.inputFile,
        lookup.kind === 'json' ? { input: parseJson(lookup.text) } : undefined,
      );
    }
    return inputs.get(test.inputFile);
  };
}

/**
 * Prepares a test as the adapter does. Undefined when the input is missing or the context does
 * not select one item, which the conformance run reports.
 */
export async function prepareTest(
  suite: SuiteId,
  test: SuiteTest,
  entry: SuiteInput | undefined,
): Promise<PreparedTest | undefined> {
  if (entry === undefined) {
    return undefined;
  }
  const options = evaluationOptions(suite, test);
  const hooks = hooksFor(suite);
  let focus = entry.input;
  if (test.context !== undefined) {
    let selected: readonly unknown[];
    try {
      selected = await compileUnchecked(test.context, compileOptionsFor(options)).evaluateAsync(
        focus,
        { output: 'typed', hooks },
      );
    } catch {
      return undefined;
    }
    if (selected.length !== 1) {
      return undefined;
    }
    focus = selected[0];
  }
  return {
    focus,
    hooks,
    options: expressionOptionsFor(options, focus, test.context !== undefined),
  };
}

/** Evaluates the test's expression on its focus without static analysis. */
export async function evaluateUnchecked(
  test: SuiteTest,
  prepared: PreparedTest,
): Promise<UncheckedOutcome> {
  try {
    const items = await compileUnchecked(test.expression, prepared.options).evaluateAsync(
      prepared.focus,
      { output: 'typed', hooks: prepared.hooks },
    );
    return { ok: true, items };
  } catch (error) {
    return { ok: false, error };
  }
}
