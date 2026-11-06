/**
 * Converts the suite's FHIR XML inputs to JSON (T0023): writes `name.json` next to each XML input
 * `name.xml` that a suite references, and removes converted files whose XML input is gone. A unit
 * test (`src/fixture-conversion.test.ts`) fails while the committed files are not what this script
 * writes.
 *
 * Usage: `pnpm --filter @callis/conformance convert-fixtures`. No network needed.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  convertedFiles,
  convertSuiteFixtures,
  UNCONVERTED_INPUTS,
} from '../src/fixture-conversion.ts';
import { FIXTURES_DIR, loadSuite } from '../src/fixtures.ts';
import { SUITE_IDS } from '../src/suite.ts';

for (const id of SUITE_IDS) {
  const conversions = convertSuiteFixtures(loadSuite(id));
  for (const { output, json } of conversions) {
    const path = join(FIXTURES_DIR, id, output);
    if (existsSync(path) && readFileSync(path, 'utf8') === json) continue;
    writeFileSync(path, json);
    console.log(`  wrote ${id}/${output}`);
  }
  const outputs = new Set(conversions.map((conversion) => conversion.output));
  for (const name of convertedFiles(id)) {
    if (!outputs.has(name)) {
      rmSync(join(FIXTURES_DIR, id, name));
      console.log(`  removed ${id}/${name}`);
    }
  }
  console.log(`${id}: ${conversions.length} XML inputs converted`);
}
for (const { suite, file, reason } of UNCONVERTED_INPUTS) {
  console.log(`Not converted: ${suite}/${file} (${reason})`);
}
console.log('Now run `pnpm conformance`.');
