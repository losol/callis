/**
 * The conformance numbers of commits that have no committed report.
 *
 * Until the reports stopped being committed, every commit held `docs/conformance/<suite>.md`, and
 * the page read the totals from it (`parseConformanceReport` in `git.ts`). A commit now holds only
 * the baseline, `tools/conformance/baseline/<suite>.txt`: the passing tests of the suite, one ID per
 * line. CI makes it exact (`pnpm conformance --check` fails on a passing test that is not in it), so
 * the number of passing tests at a commit is the number of its baseline entries. Which of them are
 * Phase 1 tests comes from a run of the suite at build time ({@link parseTestResults}), so the page
 * needs no engine at an old commit. The totals are the suite's of the checkout being built, and so
 * is the phase of each test, which only differs from the commit's when the fixtures or the
 * classification changed in between.
 */
import type { Conformance, ConformanceSuite } from './types.ts';

/** The tests of one suite at the checkout the site is built from. */
export interface SuiteTests {
  /** Every test of the suite. */
  total: number;
  /** The IDs of the Phase 1 tests, the target of release 0.1.0. */
  phase1: ReadonlySet<string>;
}

/** The suites at the checkout, and the adapter that ran them. */
export interface ConformanceTests {
  adapter: string;
  suites: Record<string, SuiteTests>;
}

/**
 * Reads the `--results` file of `pnpm conformance` (`renderResults()` in
 * `tools/conformance/src/cli.ts`): every test with its suite, ID and phase.
 */
export function parseTestResults(json: string): ConformanceTests {
  const data: unknown = JSON.parse(json);
  const results = isRecord(data) ? data.results : undefined;
  if (!isRecord(data) || typeof data.adapter !== 'string' || !Array.isArray(results)) {
    throw new Error('The conformance results are not in the expected format.');
  }
  const suites = new Map<string, { total: number; phase1: Set<string> }>();
  for (const result of results) {
    if (!isRecord(result) || typeof result.suite !== 'string' || typeof result.id !== 'string') {
      throw new Error('A conformance result has no suite or ID.');
    }
    let suite = suites.get(result.suite);
    if (suite === undefined) {
      suite = { total: 0, phase1: new Set() };
      suites.set(result.suite, suite);
    }
    suite.total += 1;
    if (result.phase === 'phase1') {
      suite.phase1.add(result.id);
    }
  }
  return { adapter: data.adapter, suites: Object.fromEntries(suites) };
}

/** The test IDs of a baseline file: one per line, in any order, blank lines and repeats ignored. */
export function parseBaselineIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split('\n')) {
    const id = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (id !== '') {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * The conformance of a commit from its baseline files (the text of each, by suite). Counts only
 * what the baseline tells: the tests that pass. Null when the commit has no baseline of a suite
 * that the checkout knows.
 */
export function conformanceFromBaseline(
  baselines: Readonly<Record<string, string>>,
  tests: ConformanceTests,
): Conformance | null {
  const suites: Record<string, ConformanceSuite> = {};
  for (const [name, text] of Object.entries(baselines)) {
    const known = Object.hasOwn(tests.suites, name) ? tests.suites[name] : undefined;
    if (known === undefined) {
      continue;
    }
    const passing = parseBaselineIds(text);
    const phase1Passed = [...passing].filter((id) => known.phase1.has(id)).length;
    suites[name] = {
      total: known.total,
      passed: passing.size,
      phase1: { total: known.phase1.size, passed: phase1Passed },
    };
  }
  return Object.keys(suites).length === 0 ? null : { adapter: tests.adapter, suites };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
