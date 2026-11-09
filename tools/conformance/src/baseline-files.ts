/**
 * Reads and writes the baseline files, `tools/conformance/baseline/<suite>.txt`. The format and the
 * ratchet are in `baseline.ts`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Baseline,
  baselineFileName,
  parseBaselineList,
  serializeBaselineList,
} from './baseline.ts';
import { CONFORMANCE_DIR } from './fixtures.ts';
import { SUITE_IDS, type SuiteId } from './suite.ts';

/** `tools/conformance/baseline/`. */
export const BASELINE_DIR: string = join(CONFORMANCE_DIR, 'baseline');

/** Reads the baseline of every suite. A missing file is an error: a new suite needs an empty one. */
export function readBaseline(dir: string = BASELINE_DIR): Baseline {
  const baseline: Record<SuiteId, readonly string[]> = { r4: [], r5: [] };
  for (const suite of SUITE_IDS) {
    const path = join(dir, baselineFileName(suite));
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error(
          `${path}: baseline file not found. A suite without passing tests needs an empty file.`,
        );
      }
      throw error;
    }
    baseline[suite] = parseBaselineList(text);
  }
  return baseline;
}

/** Writes the baseline of every suite, sorted, one test per line. */
export function writeBaseline(baseline: Baseline, dir: string = BASELINE_DIR): void {
  mkdirSync(dir, { recursive: true });
  for (const suite of SUITE_IDS) {
    writeFileSync(join(dir, baselineFileName(suite)), serializeBaselineList(baseline[suite]));
  }
}
