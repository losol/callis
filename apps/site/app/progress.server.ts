import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { PlanTask, ProgressData } from '../progress/types.ts';
import { getContentSource } from './content.server.ts';
import type { DocLink } from './doc-links.ts';

/** The progress data that `scripts/collect.ts` wrote before the build. */
export function getProgress(): ProgressData {
  return JSON.parse(readFileSync(resolve('.lectio/progress.json'), 'utf-8')) as ProgressData;
}

/**
 * Where to read each task file, keyed by task ID: its page on this site, or the
 * file on GitHub when the site does not publish it. The task files are linked
 * from `docs/roadmap.md`, so they are resolved as the roadmap's links are.
 */
export function getTaskPages(plan: readonly PlanTask[]): Record<string, DocLink> {
  const source = getContentSource();
  const pages: Record<string, DocLink> = {};
  for (const task of plan) {
    const link = source.resolveLink(task.file, 'docs/roadmap.md');
    const forge = source.sourceHref(`docs/${task.file}`);
    if (link?.page) {
      pages[task.id] = { href: link.page.slug, external: false };
    } else if (forge !== null) {
      pages[task.id] = { href: forge, external: true };
    }
  }
  return pages;
}
