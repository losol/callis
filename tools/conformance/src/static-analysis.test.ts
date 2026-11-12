/**
 * Static analysis over the HL7 suite ([T0024](../../../docs/tasks/T0024-static-analysis.md)).
 * Without a model, no expression the suite expects to evaluate is rejected by analysis that cannot
 * see the input's types. With the suite's models and inputs, the analysis is sound: an expression
 * that evaluates on its input gets no error from lenient analysis. The suite's `invalid="semantic"`
 * tests are the exception the suite asks for: the Java runner rejects them statically although
 * some of them would evaluate, so they are left out. And strict mode is safe: an expression it
 * accepts does not fail at evaluation for want of a single item. The analysis with the suite's
 * models and input types is measured by the conformance run itself.
 */
import { describe, expect, it } from 'vitest';
import { analyze } from '../../../packages/core/src/api/compile.ts';
import { FhirPathEvaluationError } from '../../../packages/core/src/errors/fhirpath-error.ts';
import { classifyTest } from './classify.ts';
import { loadSuite } from './fixtures.ts';
import { allTests, SUITE_IDS } from './suite.ts';
import { evaluateUnchecked, inputReader, prepareTest } from './suite-evaluation.ts';

describe.each(SUITE_IDS)('model-less analysis of the %s suite', (id) => {
  const tests = allTests(loadSuite(id)).filter(
    (test) => test.invalid === undefined && classifyTest(test).phase === 'phase1',
  );

  it('rejects no phase-1 expression that the suite expects to evaluate', () => {
    const rejected: string[] = [];
    for (const test of tests) {
      for (const diagnostic of analyze(test.expression).diagnostics) {
        // A function a later task adds is unknown to the registry, not a false error, and what
        // does not parse (htmlTest01, docs/spec-notes.md#reserved-div-in-an-html-fixture) is
        // the parser's.
        if (
          diagnostic.severity === 'error' &&
          diagnostic.code !== 'semantic/unknown-function' &&
          !diagnostic.code.startsWith('syntax/')
        ) {
          rejected.push(`${test.id}: ${diagnostic.code} ${diagnostic.message}`);
        }
      }
    }
    expect(rejected).toEqual([]);
    expect(tests.length).toBeGreaterThan(800);
  });
});

describe.each(SUITE_IDS)('analysis of the %s suite with its model and inputs', (id) => {
  const read = inputReader(id);
  const tests = allTests(loadSuite(id)).filter((test) => test.invalid !== 'semantic');

  it('reports no error for an expression that evaluates on its input', async () => {
    const unsound: string[] = [];
    let evaluated = 0;
    for (const test of tests) {
      const prepared = await prepareTest(id, test, read(test));
      if (prepared === undefined || !(await evaluateUnchecked(test, prepared)).ok) {
        continue;
      }
      evaluated++;
      const error = analyze(test.expression, prepared.options).diagnostics.find(
        (diagnostic) => diagnostic.severity === 'error',
      );
      if (error !== undefined) {
        unsound.push(`${test.id}: ${error.code} ${error.message}`);
      }
    }
    expect(unsound).toEqual([]);
    expect(evaluated).toBeGreaterThan(700);
  }, 120_000);
});

describe.each(SUITE_IDS)('strict analysis of the %s suite with its model and inputs', (id) => {
  const read = inputReader(id);
  // single() raises the singleton error by its contract when its input has more than one item
  // ([N1 §5.2.6](https://hl7.org/fhirpath/N1/#single-collection)): that error is the result the
  // expression asks for, not an unsafe use, so those tests are left out.
  const tests = allTests(loadSuite(id)).filter((test) => !/\bsingle\s*\(/.test(test.expression));

  // N1 §11: what strict mode accepts must not fail at evaluation for the reason strict mode
  // exists, an operation that needs one item and gets more.
  it('accepts no expression whose evaluation needs a singleton it does not get', async () => {
    const unsafe: string[] = [];
    let accepted = 0;
    for (const test of tests) {
      const prepared = await prepareTest(id, test, read(test));
      if (prepared === undefined) {
        continue;
      }
      const strict = { ...prepared.options, strict: true };
      if (analyze(test.expression, strict).diagnostics.some((d) => d.severity === 'error')) {
        continue;
      }
      accepted++;
      const outcome = await evaluateUnchecked(test, prepared);
      if (
        !outcome.ok &&
        outcome.error instanceof FhirPathEvaluationError &&
        outcome.error.code === 'eval/singleton-expected'
      ) {
        unsafe.push(`${test.id}: ${outcome.error.message}`);
      }
    }
    expect(unsafe).toEqual([]);
    expect(accepted).toBeGreaterThan(700);
  }, 120_000);
});
