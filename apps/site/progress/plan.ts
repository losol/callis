import { parseRoadmap } from '../../../scripts/roadmap.ts';
import { extractGoal } from './goal.ts';
import { extractItems } from './items.ts';
import type { CommitPoint, PlanTask } from './types.ts';

/**
 * The plan of the roadmap, with the commit that merged each task and the goal
 * from each task file. The roadmap is read with `parseRoadmap`, the parser the
 * roadmap check uses, so its format is read in one place.
 *
 * @param readTaskFile Reads a task file by its path relative to `docs/`.
 */
export function buildPlan(
  roadmapMarkdown: string,
  readTaskFile: (file: string) => string,
  commits: readonly Pick<CommitPoint, 'tasks'>[],
): PlanTask[] {
  const doneAt = new Map<string, number>();
  commits.forEach((commit, index) => {
    for (const id of commit.tasks) {
      if (!doneAt.has(id)) {
        doneAt.set(id, index);
      }
    }
  });

  return parseRoadmap(roadmapMarkdown).tasks.map((task) => {
    const taskFile = readTaskFile(task.file);
    return {
      id: task.id,
      title: task.title,
      file: task.file,
      phase: Number(task.phase),
      deps: [...task.dependsOn],
      wave: Number(task.wave),
      size: task.size,
      doneAt: doneAt.get(task.id) ?? null,
      items: extractItems(task.id, taskFile),
      goal: extractGoal(taskFile),
    };
  });
}
