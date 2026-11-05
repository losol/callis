import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ProgressData } from '../progress/types.ts';

/** The progress data that `scripts/collect.ts` wrote before the build. */
export function getProgress(): ProgressData {
  return JSON.parse(readFileSync(resolve('.lectio/progress.json'), 'utf-8')) as ProgressData;
}
