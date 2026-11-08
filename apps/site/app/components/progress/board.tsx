import { useEffect, useRef, useState } from 'react';

import { isDoneAt, statusAt } from '../../../progress/state.ts';
import type { CommitPoint, PlanTask } from '../../../progress/types.ts';
import type { DocLink } from '../../doc-links.ts';
import { TaskDrawer } from './task-drawer.tsx';
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
 * that depend on it; clicking it shows its details in a drawer, which another
 * click on a tile switches to that task.
 */
export function Board({ plan, commits, active, taskPages = {} }: BoardProps) {
  // The pointer wins while it is over a tile, then the focused tile, then the task in the drawer.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const tiles = useRef(new Map<string, HTMLButtonElement>());
  // The tile to focus once the drawer has closed (and the page behind it is no longer inert).
  const refocus = useRef<string | null>(null);

  const waves = [...new Set(plan.map((task) => task.wave))].sort((a, b) => a - b);
  const pointedId = hoveredId ?? focusedId;
  const highlighted = plan.find((task) => task.id === (pointedId ?? shownId));
  const shown = plan.find((task) => task.id === shownId);

  /** Shows a task in the drawer and moves the focus into it. */
  const show = (id: string) => {
    setShownId(id);
    setFocusRequest((count) => count + 1);
  };

  // Keep the tile of the shown task in view, clear of the drawer (the board's scroll-padding).
  // After the drawer closed, return the focus. This runs after the drawer's own cleanup, which
  // lifts the inert state of the page on narrow screens; an inert tile cannot take the focus.
  useEffect(() => {
    if (shownId !== null) {
      tiles.current.get(shownId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else if (refocus.current !== null) {
      tiles.current.get(refocus.current)?.focus();
      refocus.current = null;
    }
  }, [shownId]);

  /** Closes the drawer; from inside it, the focus goes back to the tile of its task. */
  const close = (returnFocus: boolean) => {
    refocus.current = returnFocus ? shownId : null;
    setShownId(null);
  };

  return (
    <>
      <div className={shown ? 'pg-board-wrap has-drawer' : 'pg-board-wrap'}>
        {/* Only the pointer or the focus dims the rest of the board; the drawer alone does not. */}
        <div className={pointedId ? 'pg-board has-highlight' : 'pg-board'}>
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
                    task.id === shownId ? 'selected' : '',
                  ];
                  return (
                    <button
                      key={task.id}
                      ref={(element) => {
                        if (element) {
                          tiles.current.set(task.id, element);
                        } else {
                          tiles.current.delete(task.id);
                        }
                      }}
                      type="button"
                      className={classes.filter(Boolean).join(' ')}
                      aria-haspopup="dialog"
                      aria-current={task.id === shownId ? 'true' : undefined}
                      onClick={() => show(task.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape' && shownId !== null) {
                          close(false);
                        }
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
      {shown && (
        <TaskDrawer
          task={shown}
          plan={plan}
          commits={commits}
          active={active}
          page={taskPages[shown.id]}
          focusRequest={focusRequest}
          onShow={show}
          onClose={() => close(true)}
        />
      )}
    </>
  );
}
