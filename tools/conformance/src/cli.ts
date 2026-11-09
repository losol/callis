/**
 * Runs the HL7 FHIRPath test suite and reports the results.
 *
 * Usage: `pnpm conformance [--update-baseline | --check | --reports-only] [--reports <dir>]
 * [--results <file>] [--summary <file>]`
 *
 * The Markdown reports are generated, never committed: every mode writes them to `docs/conformance/`
 * (ignored by git), or to the directory of `--reports`.
 *
 * - default: run both suites, write the reports, and compare with the baseline in `baseline/`.
 *   Fails if a baseline test regressed.
 * - `--update-baseline`: also record the passing tests in the baseline (refused on regressions).
 * - `--check` (CI): fail on regressions or on a baseline that is out of date. Appends a job summary
 *   to `$GITHUB_STEP_SUMMARY` when it is set.
 * - `--reports-only` (the site build): write the reports and read no baseline. Never fails on test
 *   results.
 * - `--reports <dir>`: where to write the Markdown reports.
 * - `--results <file>`: also write every test result as JSON (a CI artifact).
 * - `--summary <file>`: also write the counts per suite, phase and group as JSON (a CI artifact).
 *
 * The exit code comes from `ratchetFails()` in `baseline.ts`.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { checkRatchet, type RatchetMode, ratchetFails, updateBaseline } from './baseline.ts';
import { BASELINE_DIR, readBaseline, writeBaseline } from './baseline-files.ts';
import { PHASE_LABELS, PHASES } from './classify.ts';
import { engineAdapter } from './engine-adapter.ts';
import { loadSuite, REPOSITORY_ROOT, readFixtureSource } from './fixtures.ts';
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
    'reports-only': { type: 'boolean', default: false },
    reports: { type: 'string' },
    results: { type: 'string' },
    summary: { type: 'string' },
  },
});
if ([values.check, values['update-baseline'], values['reports-only']].filter(Boolean).length > 1) {
  console.error('--check, --update-baseline and --reports-only cannot be combined.');
  process.exit(2);
}

const reportsDir =
  values.reports === undefined
    ? join(REPOSITORY_ROOT, 'docs', 'conformance')
    : resolve(values.reports);
const context: ReportContext = { adapter: engineAdapter.name, source: readFixtureSource() };

const runner = createRunner({ adapter: engineAdapter });
const runs: SuiteRun[] = [];
for (const id of SUITE_IDS) {
  runs.push(await runner.runSuite(loadSuite(id)));
}
const summaries = runs.map(summarize);

mkdirSync(reportsDir, { recursive: true });
for (const [i, run] of runs.entries()) {
  const summary = summaries[i];
  if (summary !== undefined) {
    writeFileSync(join(reportsDir, `${run.suite.id}.md`), renderSuiteReport(run, summary, context));
  }
}

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
console.log(`Reports written to ${displayPath(reportsDir)}/.`);

if (values.results !== undefined) {
  writeFileSync(values.results, renderResults(runs));
}
if (values.summary !== undefined) {
  writeFileSync(values.summary, renderJsonSummary(summaries, context));
}

if (!values['reports-only']) {
  const mode: RatchetMode = values.check
    ? 'check'
    : values['update-baseline']
      ? 'update'
      : 'report';
  const baseline = readBaseline();
  const ratchet = checkRatchet(baseline, runs);
  if (mode === 'update' && ratchet.regressions.length === 0) {
    writeBaseline(updateBaseline(baseline, runs));
    console.log(`Baseline updated: ${displayPath(BASELINE_DIR)}/.`);
  } else {
    for (const message of ratchetMessages(ratchet, mode)) {
      console.log(message);
    }
  }
  if (mode === 'check') {
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile !== undefined && summaryFile !== '') {
      appendFileSync(summaryFile, renderJobSummary(summaries, ratchet, context));
    }
  }
  process.exitCode = ratchetFails(mode, ratchet) ? 1 : 0;
}

/** A path relative to the repository root, or as it is when it lies outside it. */
function displayPath(path: string): string {
  const inside = relative(REPOSITORY_ROOT, path);
  return inside.startsWith('..') ? path : inside || '.';
}

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
