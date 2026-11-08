import type { CommitPoint, PlanTask, ProgressData, SuiteTotals } from './types.ts';

export type TaskStatus = 'done' | 'ready' | 'blocked';

/** Whether the task is merged at the commit with this index. */
export function isDoneAt(task: PlanTask, index: number): boolean {
  return task.doneAt !== null && task.doneAt <= index;
}

/**
 * Merged, unblocked (every dependency is merged) or blocked, at the commit with
 * this index. A dependency that is not in the plan blocks the task.
 */
export function statusAt(plan: readonly PlanTask[], task: PlanTask, index: number): TaskStatus {
  if (isDoneAt(task, index)) {
    return 'done';
  }
  return waitingForAt(plan, task, index).length === 0 ? 'ready' : 'blocked';
}

/**
 * The IDs of the task's dependencies that are not merged at the commit with
 * this index, in roadmap order. A dependency that is not in the plan counts as
 * not merged.
 */
export function waitingForAt(plan: readonly PlanTask[], task: PlanTask, index: number): string[] {
  return task.deps.filter((id) => {
    const dep = plan.find((candidate) => candidate.id === id);
    return dep === undefined || !isDoneAt(dep, index);
  });
}

/** The tasks that depend directly on this one, in plan order. */
export function dependentsOf(plan: readonly PlanTask[], task: PlanTask): PlanTask[] {
  return plan.filter((candidate) => candidate.deps.includes(task.id));
}

export function tasksDoneAt(plan: readonly PlanTask[], index: number): number {
  return plan.filter((task) => isDoneAt(task, index)).length;
}

export function itemsTotal(plan: readonly PlanTask[]): number {
  return plan.reduce((sum, task) => sum + task.items.length, 0);
}

/** Functions and operators that belong to a merged task. */
export function itemsDoneAt(plan: readonly PlanTask[], index: number): number {
  return plan
    .filter((task) => isDoneAt(task, index))
    .reduce((sum, task) => sum + task.items.length, 0);
}

/** The Phase 1 totals of a suite at a commit, if the commit has a summary. */
export function phase1Of(commit: CommitPoint, suite: string): SuiteTotals | null {
  return commit.conformance?.suites[suite]?.phase1 ?? null;
}

/** The Phase 1 pass rate, from 0 to 1, or null when there is no summary or no test. */
export function passRate(commit: CommitPoint, suite: string): number | null {
  const totals = phase1Of(commit, suite);
  return totals !== null && totals.total > 0 ? totals.passed / totals.total : null;
}

/** The names of the suites that appear anywhere in the history. */
export function suiteNames(data: ProgressData): string[] {
  return [
    ...new Set(data.commits.flatMap((commit) => Object.keys(commit.conformance?.suites ?? {}))),
  ];
}
