import { useState } from 'react';

import { isDoneAt, statusAt, type TaskStatus } from '../../../progress/state.ts';
import type { CommitPoint, PlanTask } from '../../../progress/types.ts';

const MARK: Record<TaskStatus, string> = { done: '[x]', ready: '[>]', blocked: '[ ]' };

export interface BoardProps {
  plan: readonly PlanTask[];
  commits: readonly CommitPoint[];
  /** The selected commit. */
  active: number;
}

/** The roadmap as columns per wave; each task is merged, unblocked or blocked. */
export function Board({ plan, commits, active }: BoardProps) {
  const [hovered, setHovered] = useState<PlanTask | null>(null);
  const waves = [...new Set(plan.map((task) => task.wave))].sort((a, b) => a - b);

  return (
    <div className="pg-board-wrap">
      <div className="pg-board">
        {waves.map((wave) => (
          <div key={wave} className="pg-col">
            <h3>{`wave ${wave}`}</h3>
            {plan
              .filter((task) => task.wave === wave)
              .map((task) => {
                const status = statusAt(plan, task, active);
                const mergedAt = isDoneAt(task, active) ? commits[task.doneAt ?? 0] : undefined;
                const classes = [
                  'pg-tile',
                  status,
                  task.doneAt === active ? 'new' : '',
                  hovered?.deps.includes(task.id) ? 'dep' : '',
                ];
                return (
                  <button
                    key={task.id}
                    type="button"
                    className={classes.filter(Boolean).join(' ')}
                    title={`${task.id} ${task.title}\nphase ${task.phase}, size ${task.size}\ndepends on: ${task.deps.join(', ') || 'nothing'}`}
                    onMouseEnter={() => setHovered(task)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(task)}
                    onBlur={() => setHovered(null)}
                  >
                    <span className="pg-mark">
                      {mergedAt?.pr ? `#${mergedAt.pr}` : MARK[status]}
                    </span>
                    <span className="pg-id">{task.id}</span>
                    <span className="pg-title">{task.title}</span>
                  </button>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
