import { useRef, useState } from 'react';

import { isDoneAt, statusAt } from '../../../progress/state.ts';
import type { CommitPoint, PlanTask } from '../../../progress/types.ts';
import type { DocLink } from '../../doc-links.ts';
import { TaskDialog } from './task-dialog.tsx';
import { STATUS_MARK, STATUS_NAME } from './task-status.ts';

export interface BoardProps {
  plan: readonly PlanTask[];
  commits: readonly CommitPoint[];
  /** The selected commit. */
  active: number;
  /** Where each task file is read, keyed by task ID. */
  taskPages?: Readonly<Record<string, DocLink>>;
}

/** How a tile relates to the highlighted task. */
export type TileRelation = 'current' | 'dependency' | 'dependent';

const RELATION_CLASS: Readonly<Record<TileRelation, string>> = {
  current: 'current',
  dependency: 'dep',
  dependent: 'dependent',
};

/**
 * How a task relates to the highlighted one: the highlighted task itself, one
 * it depends on, or one that depends on it. Undefined for the rest, and for
 * every task when nothing is highlighted.
 */
export function relationTo(
  highlighted: PlanTask | undefined,
  task: PlanTask,
): TileRelation | undefined {
  if (highlighted === undefined) {
    return undefined;
  }
  if (task.id === highlighted.id) {
    return 'current';
  }
  if (highlighted.deps.includes(task.id)) {
    return 'dependency';
  }
  return task.deps.includes(highlighted.id) ? 'dependent' : undefined;
}

/**
 * The roadmap as columns per wave; each task is merged, unblocked or blocked.
 * Hovering or focusing a tile highlights it with its dependencies and the tasks
 * that depend on it; clicking it opens its details.
 */
export function Board({ plan, commits, active, taskPages = {} }: BoardProps) {
  // The pointer wins while it is over a tile; otherwise the focused tile is highlighted.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  const waves = [...new Set(plan.map((task) => task.wave))].sort((a, b) => a - b);
  const highlightedId = hoveredId ?? focusedId;
  const highlighted = plan.find((task) => task.id === highlightedId);
  const shown = plan.find((task) => task.id === shownId) ?? null;

  return (
    <>
      <div className="pg-board-wrap">
        <div className={highlighted ? 'pg-board has-highlight' : 'pg-board'}>
          {waves.map((wave) => (
            <div key={wave} className="pg-col">
              <h3>{`wave ${wave}`}</h3>
              {plan
                .filter((task) => task.wave === wave)
                .map((task) => {
                  const status = statusAt(plan, task, active);
                  const mergedAt = isDoneAt(task, active) ? commits[task.doneAt ?? 0] : undefined;
                  const relation = relationTo(highlighted, task);
                  const classes = [
                    'pg-tile',
                    status,
                    task.doneAt === active ? 'new' : '',
                    relation ? RELATION_CLASS[relation] : '',
                  ];
                  return (
                    <button
                      key={task.id}
                      type="button"
                      className={classes.filter(Boolean).join(' ')}
                      aria-haspopup="dialog"
                      onClick={(event) => {
                        opener.current = event.currentTarget;
                        setShownId(task.id);
                      }}
                      onMouseEnter={() => setHoveredId(task.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onFocus={() => setFocusedId(task.id)}
                      onBlur={() => setFocusedId(null)}
                    >
                      <span className="pg-mark" aria-hidden="true">
                        {mergedAt?.pr ? `#${mergedAt.pr}` : STATUS_MARK[status]}
                      </span>
                      <span className="pg-id">{task.id}</span>
                      <span className="pg-title">{task.title}</span>
                      <span className="pg-visually-hidden">
                        {`(${STATUS_NAME[status]}${mergedAt?.pr ? ` in #${mergedAt.pr}` : ''})`}
                      </span>
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
      <TaskDialog
        task={shown}
        plan={plan}
        commits={commits}
        active={active}
        page={shown ? taskPages[shown.id] : undefined}
        onShow={setShownId}
        onClose={() => {
          setShownId(null);
          opener.current?.focus();
        }}
      />
    </>
  );
}
