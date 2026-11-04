/**
 * Runs the HL7 FHIRPath test suite and reports the results.
 *
 * Usage: `pnpm conformance [--update-baseline | --check] [--results <file>]`
 *
 * - default: run both suites, write `docs/conformance/{r4,r5}.md` and `summary.json`, and compare
 *   with `baseline.json`. Fails if a baseline test regressed.
 * - `--update-baseline`: also record the passing tests in `baseline.json` (refused on regressions).
 * - `--check` (CI): write nothing; fail on regressions, unrecorded passes or out-of-date reports.
 *   Appends a job summary to `$GITHUB_STEP_SUMMARY` when it is set.
 * - `--results <file>`: also write every test result as JSON (a CI artifact).
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { checkRatchet, parseBaseline, serializeBaseline, updateBaseline } from './baseline.ts';
import { PHASE_LABELS, PHASES } from './classify.ts';
import { engineAdapter } from './engine-adapter.ts';
import { CONFORMANCE_DIR, loadSuite, REPOSITORY_ROOT, readFixtureSource } from './fixtures.ts';
import {
  type ReportContext,
  ratchetMessages,
  renderJobSummary,
  renderJsonSummary,
  renderSuiteReport,
} from './report.ts';
import { createRunner, type SuiteRun } from './run-suite.ts';
import { SUITE_IDS } from './suite.ts';
import { summarize } from './summary.ts';

const { values } = parseArgs({
  options: {
    check: { type: 'boolean', default: false },
    'update-baseline': { type: 'boolean', default: false },
    results: { type: 'string' },
  },
});
if (values.check && values['update-baseline']) {
  console.error('--check and --update-baseline cannot be combined.');
  process.exit(2);
}

const baselinePath = join(CONFORMANCE_DIR, 'baseline.json');
const reportsDir = join(REPOSITORY_ROOT, 'docs', 'conformance');
const context: ReportContext = { adapter: engineAdapter.name, source: readFixtureSource() };

const runner = createRunner({ adapter: engineAdapter });
const runs: SuiteRun[] = [];
for (const id of SUITE_IDS) {
  runs.push(await runner.runSuite(loadSuite(id)));
}
const summaries = runs.map(summarize);

const reports = new Map<string, string>();
for (const [i, run] of runs.entries()) {
  const summary = summaries[i];
  if (summary !== undefined) {
    reports.set(join(reportsDir, `${run.suite.id}.md`), renderSuiteReport(run, summary, context));
  }
}
reports.set(join(reportsDir, 'summary.json'), renderJsonSummary(summaries, context));

const baseline = parseBaseline(readFileSync(baselinePath, 'utf8'));
const ratchet = checkRatchet(baseline, runs);

console.log(
  `FHIRPath conformance: ${context.adapter} adapter, ${context.source.repository}@${context.source.commit.slice(0, 7)}`,
);
for (const summary of summaries) {
  for (const phase of PHASES) {
    const { total, passed, failed, skipped } = summary.phases[phase];
    console.log(
      `  ${summary.suite} ${PHASE_LABELS[phase].padEnd(12)} ${passed} passed, ${failed} failed, ${skipped} skipped (of ${total})`,
    );
  }
}

if (values.results !== undefined) {
  writeFileSync(values.results, renderResults(runs));
}

let failed = false;
if (values.check) {
  const stale = [...reports]
    .filter(([path, content]) => !existsSync(path) || readFileSync(path, 'utf8') !== content)
    .map(([path]) => relative(REPOSITORY_ROOT, path));
  const messages = ratchetMessages(ratchet, stale);
  for (const message of messages) {
    console.log(message);
  }
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile !== undefined && summaryFile !== '') {
    appendFileSync(summaryFile, renderJobSummary(summaries, ratchet, stale, context));
  }
  failed =
    ratchet.regressions.length > 0 ||
    ratchet.vanished.length > 0 ||
    ratchet.newPasses.length > 0 ||
    stale.length > 0;
} else {
  for (const [path, content] of reports) {
    writeFileSync(path, content);
  }
  console.log(`Reports written to ${relative(REPOSITORY_ROOT, reportsDir)}/.`);
  if (values['update-baseline']) {
    try {
      writeFileSync(baselinePath, serializeBaseline(updateBaseline(baseline, runs)));
      console.log(`Baseline updated: ${relative(REPOSITORY_ROOT, baselinePath)}.`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      failed = true;
    }
  } else {
    for (const message of ratchetMessages(ratchet, [])) {
      console.log(message);
    }
    failed = ratchet.regressions.length > 0;
  }
}
process.exitCode = failed ? 1 : 0;

/** Every test result, for the CI artifact. */
function renderResults(suiteRuns: readonly SuiteRun[]): string {
  const results = suiteRuns.flatMap((run) =>
    run.results.map((result) => ({
      suite: result.suite,
      id: result.test.id,
      group: result.test.group,
      line: result.test.line,
      expression: result.test.expression,
      phase: result.classification.phase,
      status: result.status,
      ...(result.skipReason === undefined ? {} : { skipReason: result.skipReason }),
      ...(result.failure === undefined ? {} : { failure: result.failure }),
      ...(result.detectedLate ? { detectedLate: true } : {}),
    })),
  );
  return `${JSON.stringify({ adapter: context.adapter, fixtures: context.source.commit, results }, null, 2)}\n`;
}
