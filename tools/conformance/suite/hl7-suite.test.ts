/**
 * The HL7 FHIRPath test suite as one Vitest test per suite test, for per-test diffs. Run with
 * `pnpm test:conformance`, and filter with `-t`, for example `pnpm test:conformance -t testLiterals`.
 *
 * Skipped suite tests show up as skipped Vitest tests with the reason in their name. The CLI
 * (`pnpm conformance`) runs the same tests through the same runner and writes the reports.
 */
import { describe, expect, it } from 'vitest';
import { engineAdapter } from '../src/engine-adapter.ts';
import { loadSuite } from '../src/fixtures.ts';
import { createRunner } from '../src/run-suite.ts';
import { SUITE_IDS } from '../src/suite.ts';

const runner = createRunner({ adapter: engineAdapter });

for (const id of SUITE_IDS) {
  const suite = loadSuite(id);
  describe(id, () => {
    for (const group of suite.groups) {
      describe(group.name, () => {
        for (const test of group.tests) {
          const plan = runner.plan(id, test);
          if (plan.kind === 'skip') {
            it.skip(`${test.id} (${plan.reason})`);
            continue;
          }
          it(test.id, async () => {
            const { failure } = await runner.runTest(id, test);
            if (failure?.kind === 'wrong-output') {
              expect(failure.actual, test.expression).toEqual(failure.expected);
            }
            if (failure !== undefined) {
              expect.fail(`${failure.message}\n  expression: ${test.expression}`);
            }
          });
        }
      });
    }
  });
}
