import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { type ConformanceTests, conformanceFromBaseline } from './conformance.ts';
import { buildPlan } from './plan.ts';
import { parseTaskLines, splitSubject } from './trailers.ts';
import type {
  CommitPoint,
  Conformance,
  ConformanceSuite,
  ProgressData,
  SuiteTotals,
} from './types.ts';

// `[[:space:]]` and not `\s`: git grep uses the system's POSIX regex, and macOS has no `\s`.
const TEST_CALL = '^[[:space:]]*(it|test)(\\.(each|skip|only|todo|concurrent))*\\(';

/** Runs git in the repository, or returns '' when it fails and `allowFailure` is set. */
function git(root: string, args: string[], allowFailure = false): string {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (allowFailure) {
      return '';
    }
    throw error;
  }
}

/** Sums the counts of `git grep -c` output (`<sha>:<path>:<count>` per file). */
export function sumGrepCounts(
  output: string,
  keepPath: (path: string) => boolean = () => true,
): { count: number; files: number } {
  let count = 0;
  let files = 0;
  for (const line of output.split('\n')) {
    if (line === '') {
      continue;
    }
    const last = line.lastIndexOf(':');
    const path = line.slice(line.indexOf(':') + 1, last);
    if (!keepPath(path)) {
      continue;
    }
    count += Number(line.slice(last + 1));
    files += 1;
  }
  return { count, files };
}

/** A row of the summary table of a conformance report: `| Phase 1 | 934 | 0 | 22 | 912 |`. */
const SUMMARY_ROW = /^\| (\*\*)?([^|*]+?)(\*\*)? \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|$/;

/**
 * The totals of one conformance report (`docs/conformance/r4.md`): the Total row
 * and the Phase 1 row of its summary table. Null when the report has no table.
 */
export function parseConformanceReport(markdown: string): ConformanceSuite | null {
  const rows = new Map<string, SuiteTotals>();
  for (const line of markdown.split('\n')) {
    const match = SUMMARY_ROW.exec(line);
    if (match?.[2] === undefined) {
      continue;
    }
    const [, , name, , total, passed, failed, skipped] = match;
    rows.set(name, {
      total: Number(total),
      passed: Number(passed),
      failed: Number(failed),
      skipped: Number(skipped),
    });
  }
  const all = rows.get('Total');
  return all === undefined ? null : { ...all, phase1: rows.get('Phase 1') ?? null };
}

/** The adapter a report names: `evaluated with the **stub (no engine yet)** adapter`. */
export function parseAdapterName(markdown: string): string | null {
  return /evaluated with the \*\*(.+?)\*\* adapter/.exec(markdown)?.[1] ?? null;
}

/**
 * The conformance reports of a commit, from `docs/conformance/<suite>.md`. Only the commits before
 * the reports became generated have them.
 */
function readReports(root: string, sha: string): Conformance | null {
  const files = git(root, ['ls-tree', '--name-only', sha, 'docs/conformance/'], true)
    .split('\n')
    .filter((file) => /^docs\/conformance\/[^/]+\.md$/.test(file));
  const suites: Record<string, ConformanceSuite> = {};
  let adapter = '';
  for (const file of files) {
    const markdown = git(root, ['show', `${sha}:${file}`], true);
    const suite = parseConformanceReport(markdown);
    if (suite !== null) {
      suites[basename(file, '.md')] = suite;
      adapter ||= parseAdapterName(markdown) ?? '';
    }
  }
  return Object.keys(suites).length === 0 ? null : { adapter, suites };
}

/** The baseline files of a commit, `tools/conformance/baseline/<suite>.txt`, by suite. */
function readBaselines(root: string, sha: string): Record<string, string> {
  const files = git(root, ['ls-tree', '--name-only', sha, 'tools/conformance/baseline/'], true)
    .split('\n')
    .filter((file) => /^tools\/conformance\/baseline\/[^/]+\.txt$/.test(file));
  return Object.fromEntries(
    files.map((file) => [basename(file, '.txt'), git(root, ['show', `${sha}:${file}`], true)]),
  );
}

/**
 * The conformance of a commit: its committed reports when it has them, else what its baseline says
 * about the suites of this checkout (`conformance.ts`). Null before the runner, or without `tests`.
 */
function readConformance(
  root: string,
  sha: string,
  tests: ConformanceTests | undefined,
): Conformance | null {
  const reports = readReports(root, sha);
  if (reports !== null || tests === undefined) {
    return reports;
  }
  return conformanceFromBaseline(readBaselines(root, sha), tests);
}

function readCommit(
  root: string,
  sha: string,
  date: string,
  rawSubject: string,
  suites: ConformanceTests | undefined,
): CommitPoint {
  const { subject, pr } = splitSubject(rawSubject);
  const tests = sumGrepCounts(
    git(root, ['grep', '-cE', '-e', TEST_CALL, sha, '--', '*.test.ts'], true),
  );
  const source = sumGrepCounts(
    git(root, ['grep', '-c', '', sha, '--', 'packages/*/src/*'], true),
    (path) => path.endsWith('.ts') && !path.endsWith('.test.ts'),
  );
  return {
    sha,
    date,
    subject,
    pr,
    tasks: parseTaskLines(git(root, ['show', '-s', '--format=%B', sha])),
    conformance: readConformance(root, sha, suites),
    testCases: tests.count,
    testFiles: tests.files,
    sourceLines: source.count,
  };
}

/**
 * Reads the progress of the project from the first-parent history of `ref`.
 *
 * It reads git objects only (`git show`, `git grep`): it never checks out,
 * builds or runs an old commit. `tests` are the conformance suites of the checkout, for the commits
 * that have a baseline and no committed report.
 */
export function collectProgress(root: string, ref: string, tests?: ConformanceTests): ProgressData {
  if (git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    throw new Error(
      'The progress page needs the whole git history, and this is a shallow clone. ' +
        'Fetch it with `git fetch --unshallow` (or `fetch-depth: 0` in a workflow).',
    );
  }
  const log = git(root, ['log', '--first-parent', '--reverse', '--format=%H%x09%as%x09%s', ref]);
  const commits = log
    .split('\n')
    .filter((row) => row !== '')
    .map((row) => {
      const [sha = '', date = '', subject = ''] = row.split('\t');
      return readCommit(root, sha, date, subject, tests);
    });

  const roadmap = git(root, ['show', `${ref}:docs/roadmap.md`]);
  const plan = buildPlan(
    roadmap,
    (file) => git(root, ['show', `${ref}:docs/${file}`], true),
    commits,
  );
  return { ref, commits, plan };
}

/** The repository root, from `cwd`. */
export function repositoryRoot(cwd: string): string {
  return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
}
