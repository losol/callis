/** The data of the progress page. Collected at build time, read by the page. */

export interface SuiteTotals {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface ConformanceSuite extends SuiteTotals {
  /** The totals of the Phase 1 tests, the target of release 0.1.0. */
  phase1: SuiteTotals | null;
}

export interface Conformance {
  /** The adapter the runner used, for example `stub (no engine yet)`. */
  adapter: string;
  suites: Record<string, ConformanceSuite>;
}

export interface CommitPoint {
  sha: string;
  date: string;
  /** The subject without the ` (#123)` suffix. */
  subject: string;
  pr: number | null;
  /** Task IDs from the `Task:` lines of the commit message. */
  tasks: string[];
  /** Null when the commit has no conformance summary yet. */
  conformance: Conformance | null;
  /** Calls of `it(` and `test(` in test files. `it.each` counts once: a lower bound. */
  testCases: number;
  testFiles: number;
  /** Lines in non-test `.ts` files under `packages/*\/src`. */
  sourceLines: number;
}

export interface PlanItem {
  kind: 'function' | 'operator';
  name: string;
}

/**
 * A paragraph or a list item of a task's goal, as plain text: links are reduced
 * to their text, and code spans keep their backticks.
 */
export interface GoalBlock {
  kind: 'paragraph' | 'item';
  text: string;
}

export interface PlanTask {
  id: string;
  title: string;
  /** Path of the task file relative to `docs/`, for example `tasks/T0001-lexer.md`. */
  file: string;
  phase: number;
  deps: string[];
  wave: number;
  size: string;
  /** Index of the first commit whose message names this task, or null. */
  doneAt: number | null;
  /** The functions and operators the task adds, read from its task file. */
  items: PlanItem[];
  /** The `## Goal` section of the task file; empty when it has none. */
  goal: GoalBlock[];
}

export interface ProgressData {
  /** The ref the history was read from. */
  ref: string;
  commits: CommitPoint[];
  plan: PlanTask[];
}
