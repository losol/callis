import { describe, expect, it } from 'vitest';

import {
  isDoneAt,
  itemsDoneAt,
  itemsTotal,
  passRate,
  phase1Of,
  statusAt,
  tasksDoneAt,
} from './state.ts';
import type { CommitPoint, PlanTask } from './types.ts';

function task(id: string, deps: string[], doneAt: number | null, itemCount = 0): PlanTask {
  return {
    id,
    title: id,
    phase: 1,
    deps,
    wave: 1,
    size: 'S',
    doneAt,
    items: Array.from({ length: itemCount }, (_, index) => ({
      kind: 'function' as const,
      name: `${id}-${index}`,
    })),
  };
}

// T1 is merged at commit 1, T2 depends on T1 and is merged at commit 3,
// T3 depends on T2, and T4 depends on T1 and T3.
const plan = [
  task('T1', [], 1, 2),
  task('T2', ['T1'], 3, 1),
  task('T3', ['T2'], null),
  task('T4', ['T1', 'T3'], null),
];

describe('statusAt', () => {
  it('is blocked until every dependency is merged', () => {
    expect(statusAt(plan, plan[1] as PlanTask, 0)).toBe('blocked');
    expect(statusAt(plan, plan[3] as PlanTask, 3)).toBe('blocked');
  });

  it('is ready when all dependencies are merged and the task is not', () => {
    expect(statusAt(plan, plan[1] as PlanTask, 1)).toBe('ready');
    expect(statusAt(plan, plan[2] as PlanTask, 3)).toBe('ready');
  });

  it('is done from the commit that merged the task', () => {
    expect(statusAt(plan, plan[1] as PlanTask, 2)).toBe('ready');
    expect(statusAt(plan, plan[1] as PlanTask, 3)).toBe('done');
    expect(isDoneAt(plan[1] as PlanTask, 5)).toBe(true);
  });

  it('treats a task with no dependencies as ready until it is merged', () => {
    expect(statusAt(plan, plan[0] as PlanTask, 0)).toBe('ready');
  });

  it('blocks a task whose dependency is not in the plan', () => {
    expect(statusAt(plan, task('T9', ['T404'], null), 5)).toBe('blocked');
  });
});

describe('counts', () => {
  it('counts the tasks merged at a commit', () => {
    expect([0, 1, 2, 3].map((index) => tasksDoneAt(plan, index))).toEqual([0, 1, 1, 2]);
  });

  it('counts the functions of merged tasks', () => {
    expect(itemsTotal(plan)).toBe(3);
    expect([0, 1, 3].map((index) => itemsDoneAt(plan, index))).toEqual([0, 2, 3]);
  });
});

describe('conformance', () => {
  const commit = (conformance: CommitPoint['conformance']): CommitPoint => ({
    sha: 'a',
    date: '2026-11-04',
    subject: 's',
    pr: null,
    tasks: [],
    conformance,
    testCases: 0,
    testFiles: 0,
    sourceLines: 0,
  });
  const totals = { total: 10, passed: 5, failed: 3, skipped: 2 };

  it('reads the Phase 1 totals and the pass rate of a suite', () => {
    const point = commit({ adapter: 'x', suites: { r4: { ...totals, phase1: totals } } });
    expect(phase1Of(point, 'r4')).toEqual(totals);
    expect(passRate(point, 'r4')).toBe(0.5);
  });

  it('has no pass rate before the runner exists, or for an unknown suite', () => {
    expect(passRate(commit(null), 'r4')).toBeNull();
    expect(passRate(commit({ adapter: 'x', suites: {} }), 'r4')).toBeNull();
  });

  it('has no pass rate when there are no Phase 1 tests', () => {
    const empty = { total: 0, passed: 0, failed: 0, skipped: 0 };
    expect(
      passRate(commit({ adapter: 'x', suites: { r4: { ...empty, phase1: empty } } }), 'r4'),
    ).toBeNull();
  });
});
