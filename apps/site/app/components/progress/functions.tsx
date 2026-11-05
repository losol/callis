import { statusAt } from '../../../progress/state.ts';
import type { PlanTask } from '../../../progress/types.ts';

export interface FunctionsProps {
  plan: readonly PlanTask[];
  /** The selected commit. */
  active: number;
}

/** The functions and operators of each task; a chip lights up when its task is merged. */
export function Functions({ plan, active }: FunctionsProps) {
  return (
    <div className="pg-groups">
      {plan
        .filter((task) => task.items.length > 0)
        .map((task) => {
          const status = statusAt(plan, task, active);
          return (
            <div key={task.id} className="pg-group">
              <h3>
                {task.id}{' '}
                <em>{`${task.title.replace(/^Functions: /, '')} · ${task.items.length}`}</em>
              </h3>
              <div className="pg-chips">
                {task.items.map((item) => (
                  <span key={`${item.kind}:${item.name}`} className={`pg-chip ${status}`}>
                    {item.kind === 'function' ? `${item.name}()` : item.name}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
    </div>
  );
}
