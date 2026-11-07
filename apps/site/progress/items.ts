import type { PlanItem } from './types.ts';

interface ItemSource {
  kind: PlanItem['kind'];
  /** The `## heading` of the section to read. */
  section: string;
  /** Only read lines that match this. */
  lines?: RegExp;
  /** The backtick contents that count as an item. */
  accept: RegExp;
}

const FUNCTION_NAME = /^([A-Za-z][A-Za-z0-9]*)(?:\(.*\))?$/;
const FUNCTION_TASK: ItemSource = { kind: 'function', section: 'Goal', accept: FUNCTION_NAME };

/**
 * Where each task lists the functions and operators it adds. The task files are
 * prose, so this covers only the tasks whose lists are regular; the tests pin the
 * result. When the task files get frontmatter with a list, this module goes.
 */
export const ITEM_SOURCES: Readonly<Record<string, ItemSource>> = {
  T0010: {
    kind: 'operator',
    section: 'Scope',
    accept: /^(?:[^\w\s`]{1,2}|div|mod|in|contains)$/,
  },
  T0011: FUNCTION_TASK,
  T0012: FUNCTION_TASK,
  T0013: FUNCTION_TASK,
  T0014: FUNCTION_TASK,
  T0015: FUNCTION_TASK,
  T0016: FUNCTION_TASK,
  T0017: FUNCTION_TASK,
  T0041: FUNCTION_TASK,
  T0042: FUNCTION_TASK,
  T0020: {
    kind: 'function',
    section: 'Scope',
    lines: /extension\(|`resolve\(|Registering/,
    accept:
      /^(?:extension|hasValue|getValue|resolve|memberOf|subsumes|subsumedBy|conformsTo|htmlChecks)(?:\(.*\))?$/,
  },
};

/** The lines of a `## heading` section, without the heading. */
export function sectionLines(markdown: string, heading: string): string[] {
  const lines: string[] = [];
  let inside = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) {
      inside = line === `## ${heading}`;
    } else if (inside) {
      lines.push(line);
    }
  }
  return lines;
}

/** The functions or operators a task file lists, in order, without duplicates. */
export function extractItems(taskId: string, markdown: string): PlanItem[] {
  const source = ITEM_SOURCES[taskId];
  if (source === undefined) {
    return [];
  }
  const items: PlanItem[] = [];
  const seen = new Set<string>();
  for (const line of sectionLines(markdown, source.section)) {
    if (source.lines !== undefined && !source.lines.test(line)) {
      continue;
    }
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      const token = match[1] ?? '';
      if (!source.accept.test(token)) {
        continue;
      }
      const name = FUNCTION_NAME.exec(token)?.[1] ?? token;
      if (!seen.has(name)) {
        seen.add(name);
        items.push({ kind: source.kind, name });
      }
    }
  }
  return items;
}
