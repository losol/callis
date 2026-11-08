/**
 * Reads `docs/roadmap.md` and the task files, and checks that they agree. The overview table in
 * the roadmap is the source of truth for task titles, phases, waves, sizes and dependencies; the
 * dependency graph, the waves table and the header of each task file repeat that data and must
 * match it. The `- **Area:**` line of a task file is the source of truth for its review areas.
 * `sync-roadmap.ts` copies the same data to the GitHub task issues and project board.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AREA_NAMES, type AreaName, areaLabel, areaOfLabel } from './review-areas.ts';

/** One row of the overview table in `docs/roadmap.md`. */
export interface RoadmapTask {
  readonly id: string;
  readonly title: string;
  /** Path of the task file relative to `docs/`, for example `tasks/T0001-lexer.md`. */
  readonly file: string;
  readonly phase: string;
  readonly wave: string;
  readonly size: string;
  readonly dependsOn: readonly string[];
  /**
   * The review areas from the task file's `- **Area:**` line. {@link loadRoadmap} fills them in;
   * undefined for a task without the line ({@link DELIVERED_BEFORE_AREAS}).
   */
  readonly areas?: readonly AreaName[];
}

/** The parsed roadmap, plus the rows that could not be read. */
export interface Roadmap {
  readonly tasks: readonly RoadmapTask[];
  /** Dependencies drawn in the mermaid graph, as `[from, to]`: `to` depends on `from`. */
  readonly graphEdges: readonly (readonly [string, string])[];
  /** Task IDs listed per wave in the waves table. */
  readonly waves: ReadonlyMap<string, readonly string[]>;
  readonly problems: readonly string[];
}

const TASK_ID = /T\d{4}[a-z]?/g;
const TASK_ID_ONLY = /^T\d{4}[a-z]?$/;
const SIZES: ReadonlySet<string> = new Set(['S', 'M', 'L']);
const AREA_LINE = '- **Area:**';

/**
 * Tasks delivered before review areas existed (2026-11-08). Their files need no `- **Area:**`
 * line; every other task file has one. Never add a task to this list.
 */
export const DELIVERED_BEFORE_AREAS: ReadonlySet<string> = new Set([
  'T0000',
  'T0001',
  'T0002',
  'T0003',
  'T0004',
  'T0005',
  'T0006',
  'T0007',
  'T0008',
  'T0009',
  'T0010',
  'T0011',
  'T0012',
  'T0018',
  'T0019',
  'T0022',
  'T0023',
  'T0025',
  'T0035',
  'T0036',
  'T0037',
  'T0039',
  'T0040',
  'T0043',
  'T0044',
]);

const OVERVIEW_ROW =
  /^\| \[(?<id>[^\]]+)\]\((?<file>[^)]+)\) \| (?<title>.+?) \| (?<phase>[^|]+?) \| (?<dependsOn>[^|]+?) \| (?<wave>[^|]+?) \| (?<size>[^|]+?) \|$/;
const WAVE_ROW = /^\| (?<wave>\d+) \| (?<tasks>[^|]+?) \|/;
const GRAPH_EDGE = /^\s*(?<from>[\w& ]+?)\s*-->\s*(?<to>[\w& ]+?)\s*$/;

/** Returns the lines of a `## heading` section, without the heading. */
function section(markdown: string, heading: string): string[] {
  const lines = markdown.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) {
    return [];
  }
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

function taskIds(text: string): string[] {
  return text.match(TASK_ID) ?? [];
}

/** Task IDs in Markdown link texts, such as `[T0001](T0001-lexer.md)`. */
function linkedTaskIds(text: string): string[] {
  return [...text.matchAll(/\[(T\d{4}[a-z]?)\]/g)].flatMap((match) => match.slice(1, 2));
}

/** Parses the overview table, the dependency graph and the waves table of the roadmap. */
export function parseRoadmap(markdown: string): Roadmap {
  const problems: string[] = [];

  const tasks: RoadmapTask[] = [];
  for (const line of section(markdown, 'Overview')) {
    if (!line.startsWith('| [')) {
      continue;
    }
    const row = OVERVIEW_ROW.exec(line)?.groups;
    if (
      row?.id === undefined ||
      row.file === undefined ||
      row.title === undefined ||
      row.phase === undefined ||
      row.dependsOn === undefined ||
      row.wave === undefined ||
      row.size === undefined
    ) {
      problems.push(`Overview: cannot read the row ${JSON.stringify(line)}.`);
      continue;
    }
    tasks.push({
      id: row.id,
      title: row.title,
      file: row.file,
      phase: row.phase,
      wave: row.wave,
      size: row.size,
      dependsOn: row.dependsOn === '–' ? [] : row.dependsOn.split(',').map((id) => id.trim()),
    });
  }
  if (tasks.length === 0) {
    problems.push('Overview: no task rows found under "## Overview".');
  }

  const graphEdges: [string, string][] = [];
  for (const line of section(markdown, 'Dependency graph')) {
    const edge = GRAPH_EDGE.exec(line)?.groups;
    if (edge?.from === undefined || edge.to === undefined) {
      continue;
    }
    for (const from of taskIds(edge.from)) {
      for (const to of taskIds(edge.to)) {
        graphEdges.push([from, to]);
      }
    }
  }

  const knownIds = tasks.map((task) => task.id);
  const waves = new Map<string, string[]>();
  for (const line of section(markdown, 'Waves (suggested order)')) {
    const row = WAVE_ROW.exec(line)?.groups;
    if (row?.wave === undefined || row.tasks === undefined) {
      continue;
    }
    waves.set(row.wave, expandIdList(row.tasks, knownIds));
  }

  return { tasks, graphEdges, waves, problems };
}

function idNumber(id: string): number {
  return Number.parseInt(id.slice(1, 5), 10);
}

/** Expands `T0001, T0003` and ranges such as `T0026–T0034` to the known task IDs they cover. */
function expandIdList(text: string, knownIds: readonly string[]): string[] {
  const ids: string[] = [];
  for (const part of text.split(',')) {
    const [first, last] = taskIds(part);
    if (first === undefined) {
      continue;
    }
    if (last === undefined) {
      ids.push(first);
      continue;
    }
    const low = idNumber(first);
    const high = idNumber(last);
    ids.push(...knownIds.filter((id) => idNumber(id) >= low && idNumber(id) <= high));
  }
  return ids;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  return setA.size === setB.size && [...setB].every((item) => setA.has(item));
}

function list(ids: readonly string[]): string {
  return ids.length === 0 ? '–' : ids.join(', ');
}

/**
 * Reads the review areas of a task file's `` - **Area:** `area:functions`, `area:core` `` line.
 * Returns undefined areas when the file has no such line.
 */
export function parseTaskAreas(content: string): {
  readonly areas?: readonly AreaName[];
  readonly problems: readonly string[];
} {
  const lines = content.split('\n').filter((line) => line.startsWith(AREA_LINE));
  const [line, ...others] = lines;
  if (line === undefined) {
    return { problems: [] };
  }
  const problems: string[] = [];
  if (others.length > 0) {
    problems.push(`has ${lines.length} "${AREA_LINE}" lines; keep one.`);
  }
  const areas: AreaName[] = [];
  for (const part of line.slice(AREA_LINE.length).split(',')) {
    const value = part.trim();
    const area = /^`(area:[a-z]+)`$/.exec(value)?.[1];
    const name = area === undefined ? undefined : areaOfLabel(area);
    if (name === undefined) {
      problems.push(
        `the area ${JSON.stringify(value)} is not one of ${AREA_NAMES.map((a) => `\`${areaLabel(a)}\``).join(', ')}.`,
      );
    } else if (areas.includes(name)) {
      problems.push(`lists \`${area}\` twice.`);
    } else {
      areas.push(name);
    }
  }
  return { areas, problems };
}

/**
 * Checks a task file header against its roadmap row: the title line, the
 * `Phase 1 · wave 1 · size M.` line and the `**Depends on:**` line. Also checks the
 * `- **Area:**` line, which every task file has except those in {@link DELIVERED_BEFORE_AREAS}.
 */
function checkTaskFile(task: RoadmapTask, content: string): string[] {
  const problems: string[] = [];
  const where = `docs/${task.file}`;
  const lines = content.split('\n');

  const expectedTitle = `# ${task.id} — ${task.title}`;
  if (lines[0] !== expectedTitle) {
    problems.push(`${where}: the first line should be ${JSON.stringify(expectedTitle)}.`);
  }

  const meta = `Phase ${task.phase} · wave ${task.wave} · size ${task.size}.`;
  if (!lines.some((line) => line.startsWith('Part of the [roadmap]') && line.endsWith(meta))) {
    problems.push(`${where}: the "Part of the roadmap" line should end with "${meta}".`);
  }

  const dependsLine = lines.find((line) => line.startsWith('- **Depends on:**'));
  if (dependsLine === undefined) {
    problems.push(`${where}: no "- **Depends on:**" line.`);
  } else {
    const fileDeps = linkedTaskIds(dependsLine);
    if (!sameSet(fileDeps, task.dependsOn)) {
      problems.push(
        `${where}: depends on ${list(fileDeps)}, but the roadmap says ${list(task.dependsOn)}.`,
      );
    }
  }

  const areas = parseTaskAreas(content);
  problems.push(...areas.problems.map((problem) => `${where}: ${problem}`));
  if (areas.areas === undefined && !DELIVERED_BEFORE_AREAS.has(task.id)) {
    problems.push(
      `${where}: no "${AREA_LINE}" line. List the task's review areas, for example "${AREA_LINE} \`area:functions\`" (CONTRIBUTING.md, "Review areas and model tiers").`,
    );
  }
  return problems;
}

/**
 * Checks the roadmap for consistency: unique IDs, known dependencies, waves that come after
 * their dependencies, a graph and a waves table that match the overview, and task files whose
 * headers match their rows.
 *
 * @param taskFiles The contents of the files in `docs/tasks/`, keyed by `tasks/<file name>`.
 */
export function checkRoadmap(roadmap: Roadmap, taskFiles: ReadonlyMap<string, string>): string[] {
  const problems = [...roadmap.problems];
  const byId = new Map<string, RoadmapTask>();

  for (const task of roadmap.tasks) {
    if (!TASK_ID_ONLY.test(task.id)) {
      problems.push(`${task.id}: task IDs look like T0001, or T0008a for a split task.`);
    }
    if (byId.has(task.id)) {
      problems.push(`${task.id}: listed more than once in the overview.`);
    }
    byId.set(task.id, task);
    if (!task.file.startsWith(`tasks/${task.id}-`)) {
      problems.push(`${task.id}: the task file name should start with "${task.id}-".`);
    }
    if (!/^\d+$/.test(task.phase) || !/^\d+$/.test(task.wave)) {
      problems.push(`${task.id}: phase and wave must be numbers.`);
    }
    if (!SIZES.has(task.size)) {
      problems.push(`${task.id}: size must be S, M or L, not "${task.size}".`);
    }
  }

  for (const task of roadmap.tasks) {
    for (const dep of task.dependsOn) {
      const depTask = byId.get(dep);
      if (depTask === undefined) {
        problems.push(`${task.id}: depends on ${dep}, which is not in the overview.`);
      } else if (Number(depTask.wave) >= Number(task.wave)) {
        problems.push(
          `${task.id}: is in wave ${task.wave} but depends on ${dep} in wave ${depTask.wave}.`,
        );
      }
    }

    const graphDeps = roadmap.graphEdges.filter(([, to]) => to === task.id).map(([from]) => from);
    if (!sameSet(graphDeps, task.dependsOn)) {
      problems.push(
        `${task.id}: the graph draws ${list(graphDeps)}, but the overview says ${list(task.dependsOn)}.`,
      );
    }

    const content = taskFiles.get(task.file);
    if (content === undefined) {
      problems.push(`${task.id}: the task file docs/${task.file} does not exist.`);
    } else {
      problems.push(...checkTaskFile(task, content));
    }
  }

  for (const [from, to] of roadmap.graphEdges) {
    if (!byId.has(from) || !byId.has(to)) {
      problems.push(`Graph: the edge ${from} --> ${to} names a task that is not in the overview.`);
    }
  }

  const waveIds = new Set(roadmap.tasks.map((task) => task.wave));
  for (const wave of new Set([...waveIds, ...roadmap.waves.keys()])) {
    const expected = roadmap.tasks.filter((task) => task.wave === wave).map((task) => task.id);
    const listed = roadmap.waves.get(wave) ?? [];
    if (!sameSet(listed, expected)) {
      problems.push(
        `Waves: wave ${wave} lists ${list(listed)}, but the overview has ${list(expected)}.`,
      );
    }
  }

  const listedFiles = new Set(roadmap.tasks.map((task) => task.file));
  for (const file of taskFiles.keys()) {
    if (!listedFiles.has(file)) {
      problems.push(`docs/${file}: not listed in the roadmap overview.`);
    }
  }

  return problems;
}

/**
 * Reads and checks `docs/roadmap.md` and `docs/tasks/*.md` under the repository root. The tasks
 * carry the review areas of their task files.
 */
export function loadRoadmap(root: string): { roadmap: Roadmap; problems: string[] } {
  const docs = join(root, 'docs');
  const parsed = parseRoadmap(readFileSync(join(docs, 'roadmap.md'), 'utf8'));
  const taskFiles = new Map<string, string>();
  for (const name of readdirSync(join(docs, 'tasks'))) {
    if (/^T\d{4}.*\.md$/.test(name)) {
      taskFiles.set(`tasks/${name}`, readFileSync(join(docs, 'tasks', name), 'utf8'));
    }
  }
  const tasks = parsed.tasks.map((task) => {
    const content = taskFiles.get(task.file);
    const areas = content === undefined ? undefined : parseTaskAreas(content).areas;
    return areas === undefined ? task : { ...task, areas };
  });
  const roadmap = { ...parsed, tasks };
  return { roadmap, problems: checkRoadmap(roadmap, taskFiles) };
}

/** The repository the task issues live in. */
export const REPOSITORY = 'losol/callis';

const BLOB = `https://github.com/${REPOSITORY}/blob/main`;

/** The title of a task issue. The sync finds task issues by this `T0001:` prefix. */
export function issueTitle(task: RoadmapTask): string {
  return `${task.id}: ${task.title}`;
}

/** Returns the task ID at the start of an issue title, if any. */
export function taskIdOfIssueTitle(title: string): string | undefined {
  return /^(T\d{4}[a-z]?):/.exec(title)?.[1];
}

/** The label that marks a task issue's wave. */
export function waveLabel(task: RoadmapTask): string {
  return `wave-${task.wave}`;
}

/** The `area:*` labels of a task issue, from its task file. */
export function taskAreaLabels(task: RoadmapTask): string[] {
  return (task.areas ?? []).map(areaLabel);
}

/**
 * The labels a task issue should have: its current labels without stale wave labels, plus
 * `task`, the task's wave label and its area labels. A task without an `- **Area:**` line leaves
 * the issue's area labels as they are.
 */
export function issueLabels(task: RoadmapTask, current: readonly string[]): string[] {
  const areas = taskAreaLabels(task);
  const kept = current.filter(
    (label) =>
      label !== 'task' &&
      !/^wave-\d+$/.test(label) &&
      !(areas.length > 0 && areaOfLabel(label) !== undefined),
  );
  return ['task', waveLabel(task), ...areas, ...kept];
}

/** The body of a new task issue. The sync never rewrites the body of an existing issue. */
export function issueBody(task: RoadmapTask): string {
  return [
    `Task file: [\`docs/${task.file}\`](${BLOB}/docs/${task.file})`,
    '',
    `The task file is the source of truth for scope, design notes and acceptance criteria. Phase, wave, size and dependencies come from the [roadmap](${BLOB}/docs/roadmap.md), which \`pnpm sync:roadmap\` copies to this issue's labels, its "blocked by" links and the project board. Follow [CONTRIBUTING.md](${BLOB}/CONTRIBUTING.md) and [AGENTS.md](${BLOB}/AGENTS.md).`,
    '',
    '**When you open the PR**',
    '',
    '- Use a Conventional Commits title, and check it with `pnpm check:title`.',
    `- Start the description with \`Task: ${task.id}\` and add \`Closes #<this issue>\`.`,
    '',
  ].join('\n');
}

/** The project board fields the sync sets. */
export const PROJECT_FIELDS = ['Task', 'Phase', 'Wave', 'Size', 'Depends on'] as const;

/** A project board field name. */
export type ProjectFieldName = (typeof PROJECT_FIELDS)[number];

/** Fields with free text; the others are single-select fields. */
export const TEXT_FIELDS: ReadonlySet<ProjectFieldName> = new Set(['Task', 'Depends on']);

/** The project board field values for a task. */
export function projectFieldValues(task: RoadmapTask): Record<ProjectFieldName, string> {
  return {
    Task: task.id,
    Phase: task.phase,
    Wave: task.wave,
    Size: task.size,
    'Depends on': list(task.dependsOn),
  };
}

/** The changes that turn the `current` set into the `desired` set. */
export function setDiff<T>(
  current: Iterable<T>,
  desired: Iterable<T>,
): { readonly add: T[]; readonly remove: T[] } {
  const currentSet = new Set(current);
  const desiredSet = new Set(desired);
  return {
    add: [...desiredSet].filter((item) => !currentSet.has(item)),
    remove: [...currentSet].filter((item) => !desiredSet.has(item)),
  };
}
