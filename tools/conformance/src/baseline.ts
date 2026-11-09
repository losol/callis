/**
 * The conformance ratchet (ADR-0011). `baseline/<suite>.txt` lists every test of a suite that
 * passes, one test ID per line. A test in the baseline must keep passing; a PR that makes more tests
 * pass adds them with `pnpm conformance --update-baseline`. Entries are never removed to make CI
 * pass: the only ways out of the baseline are leaving the suite (a fixture update) or being skipped
 * on purpose (an exception with its `spec-notes.md` entry, or a test that became unsupported).
 *
 * The files are sorted lists with one entry per line, and `.gitattributes` merges them with
 * `merge=union`, so two PRs that make different tests pass merge without a conflict.
 */
import { compareOrdinal } from './ordinal.ts';
import type { SuiteRun } from './run-suite.ts';
import { allTests, type SuiteId } from './suite.ts';

/** Passing test IDs per suite file. */
export type Baseline = Readonly<Record<SuiteId, readonly string[]>>;

/** A test, by suite and ID. */
export interface TestRef {
  readonly suite: SuiteId;
  readonly id: string;
}

/** How a run compares with the baseline. */
export interface RatchetResult {
  /** Baseline tests that no longer pass. */
  readonly regressions: readonly TestRef[];
  /** Passing tests that are not in the baseline yet. */
  readonly newPasses: readonly TestRef[];
  /** Baseline tests that are no longer in the suite, for example after a fixture update. */
  readonly vanished: readonly TestRef[];
  /** Baseline tests that are now skipped on purpose: an exception, or unsupported. */
  readonly excluded: readonly TestRef[];
}

/**
 * How the runner was started: `report` (the default), `update` (`--update-baseline`) or `check`
 * (`--check`, in CI).
 */
export type RatchetMode = 'report' | 'update' | 'check';

/** The baseline file of a suite, inside the baseline directory: `r4.txt`. */
export function baselineFileName(suite: SuiteId): string {
  return `${suite}.txt`;
}

/**
 * Parses a baseline file: one test ID per line. The order, blank lines and repeated lines do not
 * matter, because a union merge of two PRs can leave them; the IDs come back sorted and unique.
 */
export function parseBaselineList(text: string): string[] {
  const ids = new Set<string>();
  for (const line of text.split('\n')) {
    const id = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (id !== '') {
      ids.add(id);
    }
  }
  return sortIds([...ids]);
}

/** Serializes the IDs of one suite: sorted, one per line, so a change is a few added lines. */
export function serializeBaselineList(ids: readonly string[]): string {
  const sorted = sortIds([...new Set(ids)]);
  const broken = sorted.find((id) => /[\r\n]/.test(id));
  if (broken !== undefined) {
    throw new Error(`A test ID cannot hold a line break: ${JSON.stringify(broken)}`);
  }
  return sorted.length === 0 ? '' : `${sorted.join('\n')}\n`;
}

/** Compares runs with the baseline. Suites that were not run are not compared. */
export function checkRatchet(baseline: Baseline, runs: readonly SuiteRun[]): RatchetResult {
  const regressions: TestRef[] = [];
  const newPasses: TestRef[] = [];
  const vanished: TestRef[] = [];
  const excluded: TestRef[] = [];
  for (const run of runs) {
    const suite = run.suite.id;
    const expected = new Set(baseline[suite]);
    const known = new Set(allTests(run.suite).map((test) => test.id));
    for (const result of run.results) {
      const id = result.test.id;
      if (expected.has(id) && result.status !== 'pass') {
        const onPurpose = result.skipCause === 'exception' || result.skipCause === 'unsupported';
        (onPurpose ? excluded : regressions).push({ suite, id });
      } else if (!expected.has(id) && result.status === 'pass') {
        newPasses.push({ suite, id });
      }
    }
    for (const id of baseline[suite]) {
      if (!known.has(id)) {
        vanished.push({ suite, id });
      }
    }
  }
  return { regressions, newPasses, vanished, excluded };
}

/**
 * Whether a run fails. A regression always fails. In `check` mode (CI) the baseline must also be up
 * to date: tests that left it or newly pass must be recorded in the PR that changes them. In `update`
 * mode they are recorded instead. Out-of-date reports never fail a run; `check` mode only warns
 * about them (owner decision on #65), so parallel PRs do not have to serialize on the report files.
 */
export function ratchetFails(mode: RatchetMode, ratchet: RatchetResult): boolean {
  if (ratchet.regressions.length > 0) {
    return true;
  }
  return (
    mode === 'check' &&
    (ratchet.vanished.length > 0 || ratchet.excluded.length > 0 || ratchet.newPasses.length > 0)
  );
}

/**
 * The baseline after these runs: the passing tests. Throws if a baseline test regressed, so a
 * regression can never be recorded. Tests that vanished from the suite or are now skipped on
 * purpose are dropped.
 */
export function updateBaseline(baseline: Baseline, runs: readonly SuiteRun[]): Baseline {
  const { regressions } = checkRatchet(baseline, runs);
  if (regressions.length > 0) {
    throw new Error(
      `Refusing to update the baseline: ${regressions.length} baseline test(s) no longer pass (${formatRefs(regressions)})`,
    );
  }
  const next: Record<SuiteId, readonly string[]> = { ...baseline };
  for (const run of runs) {
    next[run.suite.id] = sortIds(
      run.results.filter((result) => result.status === 'pass').map((result) => result.test.id),
    );
  }
  return next;
}

/** `r5/testA, r5/testB, …` for messages. */
export function formatRefs(refs: readonly TestRef[], limit = 10): string {
  const shown = refs.slice(0, limit).map((ref) => `${ref.suite}/${ref.id}`);
  return refs.length > limit ? `${shown.join(', ')}, …` : shown.join(', ');
}

function sortIds(ids: readonly string[]): string[] {
  return [...ids].sort(compareOrdinal);
}
