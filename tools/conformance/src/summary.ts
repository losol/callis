import { PHASES, type Phase } from './classify.ts';
import type { SuiteRun, TestResult } from './run-suite.ts';
import type { SuiteId } from './suite.ts';

/** Test counts. `total` is `passed + failed + skipped`. */
export interface Counts {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}

/** The counts of one group. */
export interface GroupSummary {
  readonly name: string;
  /** The phases of the group's tests, in {@link PHASES} order. */
  readonly phases: readonly Phase[];
  readonly counts: Counts;
}

/** The counts of one suite run, by phase, by group and by skip reason. */
export interface SuiteSummary {
  readonly suite: SuiteId;
  readonly file: string;
  readonly counts: Counts;
  /** Passed `invalid="semantic"` tests whose error was only found during evaluation. */
  readonly detectedLate: number;
  readonly phases: Readonly<Record<Phase, Counts>>;
  readonly groups: readonly GroupSummary[];
  /** Skip reasons with their test counts, most frequent first. */
  readonly skipReasons: readonly { readonly reason: string; readonly count: number }[];
}

/** Counts the results of a suite run. */
export function summarize(run: SuiteRun): SuiteSummary {
  const byPhase = (phase: Phase): Counts =>
    count(run.results.filter((r) => r.classification.phase === phase));
  const phases = {
    phase1: byPhase('phase1'),
    stu: byPhase('stu'),
    unsupported: byPhase('unsupported'),
  };
  const groups = run.suite.groups.map((group): GroupSummary => {
    const results = run.results.filter((r) => r.test.group === group.name);
    const present = new Set(results.map((r) => r.classification.phase));
    return {
      name: group.name,
      phases: PHASES.filter((phase) => present.has(phase)),
      counts: count(results),
    };
  });
  const reasons = new Map<string, number>();
  for (const result of run.results) {
    if (result.skipReason !== undefined) {
      reasons.set(result.skipReason, (reasons.get(result.skipReason) ?? 0) + 1);
    }
  }
  const skipReasons = [...reasons]
    .map(([reason, n]) => ({ reason, count: n }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  return {
    suite: run.suite.id,
    file: run.suite.fileName,
    counts: count(run.results),
    detectedLate: run.results.filter((r) => r.detectedLate).length,
    phases,
    groups,
    skipReasons,
  };
}

/** Counts results by status. */
export function count(results: readonly TestResult[]): Counts {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const result of results) {
    if (result.status === 'pass') {
      passed++;
    } else if (result.status === 'fail') {
      failed++;
    } else {
      skipped++;
    }
  }
  return { total: results.length, passed, failed, skipped };
}
