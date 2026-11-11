/**
 * Static analysis over the HL7 suite without a model
 * ([T0024](../../../docs/tasks/T0024-static-analysis.md)): no expression the suite expects to
 * evaluate is rejected by analysis that cannot see the input's types. The analysis with the
 * suite's models and input types is measured by the conformance run itself.
 */
import { describe, expect, it } from 'vitest';
import { analyze } from '../../../packages/core/src/api/compile.ts';
import { classifyTest } from './classify.ts';
import { loadSuite } from './fixtures.ts';
import { allTests, SUITE_IDS } from './suite.ts';

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
