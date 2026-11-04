import type { SuiteId } from './suite.ts';

/**
 * A suite test whose expectation is wrong for Callis, so it is skipped instead of run. Every
 * exception has an entry in `docs/spec-notes.md` that explains it (testing guide, "Conformance
 * suite"). Exceptions never hide a regression: an excepted test is not in the baseline.
 */
export interface SuiteException {
  /** The suite files the exception applies to. */
  readonly suites: readonly SuiteId[];
  /** Test IDs. */
  readonly tests: readonly string[];
  /** A short reason, shown in the report. */
  readonly reason: string;
  /** The heading anchor of the explanation in `docs/spec-notes.md`. */
  readonly note: string;
}

/** The exceptions in force. Add one together with its `docs/spec-notes.md` entry. */
export const SUITE_EXCEPTIONS: readonly SuiteException[] = [];

/** The exception for a test, if there is one. */
export function findException(
  exceptions: readonly SuiteException[],
  suite: SuiteId,
  testId: string,
): SuiteException | undefined {
  return exceptions.find(
    (exception) => exception.suites.includes(suite) && exception.tests.includes(testId),
  );
}
