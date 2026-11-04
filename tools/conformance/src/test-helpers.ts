/** Builders for unit tests of the runner. */
import { classifyTest } from './classify.ts';
import type { SuiteRun, TestResult, TestStatus } from './run-suite.ts';
import type { SuiteId, SuiteTest } from './suite.ts';

/** A suite test with defaults: phase 1, no input, expecting an empty result. */
export function makeTest(overrides: Partial<SuiteTest> = {}): SuiteTest {
  const name = overrides.name ?? 'test1';
  return {
    id: name,
    name,
    group: 'testGroup',
    line: 1,
    description: undefined,
    testing: undefined,
    expression: '1',
    invalid: undefined,
    outputs: [],
    inputFile: undefined,
    mode: undefined,
    predicate: false,
    ordered: undefined,
    checkOrderedFunctions: false,
    context: undefined,
    contextTypes: [],
    version: undefined,
    skipStaticCheck: false,
    ...overrides,
  };
}

/** A suite run with one group, where each test has the given status. */
export function makeRun(
  suite: SuiteId,
  entries: readonly (readonly [id: string, status: TestStatus, overrides?: Partial<TestResult>])[],
): SuiteRun {
  const tests = entries.map(([id]) => makeTest({ name: id }));
  const results = entries.map(([id, status, overrides], i): TestResult => {
    const test = tests[i] ?? makeTest({ name: id });
    return {
      suite,
      test,
      classification: classifyTest(test),
      status,
      skipReason: status === 'skip' ? 'skipped for a reason' : undefined,
      failure:
        status === 'fail' ? { kind: 'not-implemented', message: 'not implemented' } : undefined,
      detectedLate: false,
      ...overrides,
    };
  });
  return {
    suite: {
      id: suite,
      fileName: `tests-fhir-${suite}.xml`,
      groups: [{ name: 'testGroup', description: undefined, mode: undefined, tests }],
    },
    adapter: 'fake',
    results,
  };
}
