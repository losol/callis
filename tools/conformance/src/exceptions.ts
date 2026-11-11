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
export const SUITE_EXCEPTIONS: readonly SuiteException[] = [
  {
    suites: ['r4', 'r5'],
    tests: ['testLessThan29', 'testGreaterThan29', 'testLessOrEqual28'],
    reason: '3.0.0 permits calendar year/month ordering after conversion; the suite expects empty',
    note: 'ordering-calendar-years-and-months',
  },
  {
    // Owner decision in #50: keep ADR-0012 (UTC) rather than an "unknown offset" policy.
    suites: ['r4', 'r5'],
    tests: ['testEquality23', 'testNEquality17'],
    reason: 'a value without an offset is UTC (ADR-0012); the suite expects empty',
    note: 'a-value-without-a-timezone-offset-is-utc',
  },
  {
    // #51: the R5 copy, the source of truth, applies the fraction as 3.0.0 says.
    suites: ['r4'],
    tests: ['testPlusDate19'],
    reason: 'the R4 copy ignores the 0.1 s fraction; Callis follows R5 and 3.0.0',
    note: 'fractions-in-datetime-arithmetic',
  },
  {
    // T0018 (#111): the suite marks these as contested; Callis follows the model's inheritance.
    suites: ['r4', 'r5'],
    tests: ['testFHIRPathAsFunction11', 'testFHIRPathAsFunction16'],
    reason:
      'code derives from string, so as(string) and ofType(string) keep the code; the suite expects empty',
    note: 'fhir-primitives-in-is-as-and-oftype',
  },
  {
    // T0018: the normative error rule for a type that does not resolve, with no exemption.
    suites: ['r4', 'r5'],
    tests: ['testType22'],
    reason:
      'System.Patient does not resolve, so is() raises eval/unknown-type; the suite expects false',
    note: 'unresolved-type-specifiers-are-execution-errors',
  },
  {
    // Owner decision (2026-11-10): 3.0.0 over the suite (ADR-0001). The R4 copy has no such tests.
    suites: ['r5'],
    tests: ['testDistinct29', 'testDistinct36'],
    reason:
      '3.0.0 counts items whose equality is undetermined as distinct; the suite expects empty',
    note: 'distinct-and-isdistinct',
  },
  {
    // Owner decision in #148 (2026-11-11): 3.0.0 over the suite (ADR-0001), which follows N1.
    suites: ['r4', 'r5'],
    tests: ['testPolymorphismIsA3'],
    reason: '3.0.0 makes is on empty input false; the suite expects empty, as N1 says',
    note: 'is-on-empty-input-is-false',
  },
];

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
