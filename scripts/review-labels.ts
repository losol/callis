/**
 * Shows or applies the review labels of a change: its `area:*` labels and `risk:high`
 * (CONTRIBUTING.md, "Review areas and model tiers"). The rules are in `review-areas.ts`.
 *
 * Usage:
 *   pnpm review:labels                     classify this branch against origin/main, including
 *                                          uncommitted and untracked files
 *   pnpm review:labels --base <ref>        … against another base
 *   pnpm review:labels --pr 123            classify a pull request on GitHub
 *   pnpm review:labels --pr 123 --apply    add the missing labels to it; never removes one
 *   pnpm review:labels --setup             show which review labels the repository lacks
 *   pnpm review:labels --setup --apply     create them
 *
 * The PR labels workflow runs `--pr <number> --apply` from the base branch. It reads the changed
 * files and their diffs through the API as data and never runs the pull request's code. GitHub
 * calls need the GitHub CLI (`gh`) logged in, or a token in `GH_TOKEN`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type ChangedFile,
  type Classification,
  classify,
  type FileStatus,
  REVIEW_LABELS,
  type Risk,
  reExportedModules,
} from './review-areas.ts';
import { REPOSITORY } from './roadmap.ts';

const { values: flags } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    base: { type: 'string', default: 'origin/main' },
    pr: { type: 'string' },
    setup: { type: 'boolean', default: false },
  },
});
const repository = process.env.GITHUB_REPOSITORY ?? REPOSITORY;
const root = process.cwd();

/** Runs a command and returns its output. Arguments never pass through a shell. */
function run(command: string, args: readonly string[], input?: string): string {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      input: input ?? '',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr =
      error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
        ? error.stderr.trim()
        : String(error);
    throw new Error(`${command} ${args.slice(0, 3).join(' ')} failed: ${stderr}`, {
      cause: error,
    });
  }
}

function gh(args: readonly string[], body?: unknown): unknown {
  const output =
    body === undefined
      ? run('gh', args)
      : run('gh', [...args, '--input', '-'], JSON.stringify(body));
  return output.trim() === '' ? undefined : JSON.parse(output);
}

function git(args: readonly string[]): string {
  return run('git', args);
}

/** The modules that the entry points of the packages in this checkout re-export. */
function publicModules(): Set<string> {
  const modules = new Set<string>();
  const packages = join(root, 'packages');
  if (!existsSync(packages)) {
    return modules;
  }
  for (const name of readdirSync(packages)) {
    const entryPoint = `packages/${name}/src/index.ts`;
    if (existsSync(join(root, entryPoint))) {
      for (const module of reExportedModules(
        entryPoint,
        readFileSync(join(root, entryPoint), 'utf8'),
      )) {
        modules.add(module);
      }
    }
  }
  return modules;
}

// --- Changed files on GitHub ---

interface RestFile {
  readonly filename: string;
  readonly previous_filename?: string;
  readonly status: FileStatus;
  readonly additions: number;
  readonly deletions: number;
  readonly patch?: string;
}

interface RestPull {
  readonly changed_files: number;
  readonly labels: readonly { readonly name: string }[];
}

/**
 * The files of a pull request. GitHub lists at most 3000; a shorter list than the pull request's
 * `changed_files` cannot be classified safely, so it raises the risk.
 * https://docs.github.com/rest/pulls/pulls#list-pull-requests-files
 */
function pullRequestFiles(number: string): { pull: RestPull; files: ChangedFile[]; risks: Risk[] } {
  const pull = gh(['api', `repos/${repository}/pulls/${number}`]) as RestPull;
  const pages = gh([
    'api',
    '--paginate',
    '--slurp',
    `repos/${repository}/pulls/${number}/files?per_page=100`,
  ]) as RestFile[][];
  const files = pages.flat().map(
    (file): ChangedFile => ({
      path: file.filename,
      ...(file.previous_filename === undefined ? {} : { previousPath: file.previous_filename }),
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      ...(file.patch === undefined ? {} : { patch: file.patch }),
    }),
  );
  const risks: Risk[] =
    files.length < pull.changed_files
      ? [
          {
            path: '(pull request)',
            reason: `GitHub listed ${files.length} of its ${pull.changed_files} changed files`,
          },
        ]
      : [];
  return { pull, files, risks };
}

// --- Changed files in this checkout ---

const GIT_STATUS: Readonly<Record<string, FileStatus>> = {
  A: 'added',
  C: 'copied',
  D: 'removed',
  M: 'modified',
  R: 'renamed',
  T: 'changed',
};

/** The diff hunks of one file, from the first `@@` line on, or undefined for a binary file. */
function localPatch(base: string, paths: readonly string[]): string | undefined {
  const diff = git(['diff', '-M', '--no-color', '--no-ext-diff', base, '--', ...paths]);
  const start = diff.search(/^@@/m);
  return start === -1 ? undefined : diff.slice(start);
}

/** The files that differ between the merge base with `base` and the working tree. */
function localFiles(base: string): ChangedFile[] {
  const mergeBase = git(['merge-base', base, 'HEAD']).trim();
  // -z separates the fields with NUL, so every file name is read exactly as it is.
  const fields = git(['diff', '-M', '--numstat', '-z', mergeBase]).split('\0');
  const counts = new Map<string, { additions: number; deletions: number }>();
  for (let index = 0; index < fields.length; index++) {
    const [additions, deletions, path] = (fields[index] ?? '').split('\t');
    if (additions === undefined || deletions === undefined || path === undefined) {
      continue;
    }
    // A rename has an empty path, followed by the old and the new path.
    if (path === '') {
      index += 2;
    }
    const key = path === '' ? fields[index] : path;
    if (key !== undefined) {
      counts.set(key, {
        additions: Number.parseInt(additions, 10) || 0,
        deletions: Number.parseInt(deletions, 10) || 0,
      });
    }
  }

  const files: ChangedFile[] = [];
  const status = git(['diff', '-M', '--name-status', '-z', mergeBase]).split('\0');
  for (let index = 0; index < status.length - 1; ) {
    const code = status[index++] ?? '';
    const moved = code.startsWith('R') || code.startsWith('C');
    const previousPath = moved ? status[index++] : undefined;
    const path = status[index++];
    if (path === undefined) {
      break;
    }
    const patch = localPatch(mergeBase, previousPath === undefined ? [path] : [previousPath, path]);
    files.push({
      path,
      ...(previousPath === undefined ? {} : { previousPath }),
      status: GIT_STATUS[code.charAt(0)] ?? 'modified',
      ...(counts.get(path) ?? { additions: 0, deletions: 0 }),
      ...(patch === undefined ? {} : { patch }),
    });
  }
  for (const path of git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0')) {
    if (path !== '') {
      files.push({ path, status: 'added', additions: 0, deletions: 0 });
    }
  }
  return files;
}

// --- Output ---

const TIER_TEXT = {
  core: 'core',
  standard: 'standard',
  tooling: 'tooling',
  light: 'light (only P1 and P2 findings block)',
} as const;

/** Prints a classification. Paths are JSON strings, so a file name cannot inject log commands. */
function report(result: Classification): void {
  console.log(`Areas: ${result.areas.length === 0 ? '(none)' : result.areas.join(', ')}`);
  if (result.risks.length > 0) {
    console.log('risk:high, because of:');
    for (const risk of result.risks) {
      console.log(`  - ${JSON.stringify(risk.path)}: ${risk.reason}`);
    }
  }
  const raised = result.tier === result.baseTier ? '' : ` (raised from ${result.baseTier})`;
  const second = result.secondReviewer ? ', with a second reviewer from the other vendor' : '';
  console.log(`Tier: ${TIER_TEXT[result.tier]}${raised}${second}`);
  console.log(`Labels: ${result.labels.length === 0 ? '(none)' : result.labels.join(', ')}`);
  console.log('Workers and reviewers per tier: CONTRIBUTING.md, "Model matrix".');
}

function setup(): void {
  const existing = new Map(
    (
      gh(['api', '--paginate', '--slurp', `repos/${repository}/labels?per_page=100`]) as {
        name: string;
        color: string;
        description: string | null;
      }[][]
    )
      .flat()
      .map((label) => [label.name, label]),
  );
  let missing = 0;
  for (const label of REVIEW_LABELS) {
    const current = existing.get(label.name);
    if (current === undefined) {
      missing++;
      console.log(`${flags.apply ? '' : '(dry run) '}+ label ${label.name}`);
      if (flags.apply) {
        // https://docs.github.com/rest/issues/labels#create-a-label
        gh(['api', '--method', 'POST', `repos/${repository}/labels`], label);
      }
    } else if (
      current.color.toLowerCase() !== label.color.toLowerCase() ||
      current.description !== label.description
    ) {
      console.log(`= label ${label.name} exists with another color or description; left as it is`);
    }
  }
  if (missing === 0) {
    console.log('✓ Every review label exists.');
  } else if (!flags.apply) {
    console.log('Run with --apply to create them.');
  }
}

function labelPullRequest(number: string): void {
  if (!/^\d+$/.test(number)) {
    throw new Error(`--pr takes a pull request number, not ${JSON.stringify(number)}.`);
  }
  const { pull, files, risks } = pullRequestFiles(number);
  const result = classify(files, publicModules(), risks);
  report(result);
  const current = new Set(pull.labels.map((label) => label.name));
  const missing = result.labels.filter((label) => !current.has(label));
  if (missing.length === 0) {
    console.log(`✓ #${number} has every label already.`);
    return;
  }
  console.log(`${flags.apply ? '' : '(dry run) '}+ #${number} labels ${missing.join(', ')}`);
  if (flags.apply) {
    // Only adds: a label set by hand, or by an earlier push, stays.
    // https://docs.github.com/rest/issues/labels#add-labels-to-an-issue
    gh(['api', '--method', 'POST', `repos/${repository}/issues/${number}/labels`], {
      labels: missing,
    });
  } else {
    console.log('Run with --apply to add them.');
  }
}

try {
  if (flags.setup) {
    setup();
  } else if (flags.pr !== undefined) {
    labelPullRequest(flags.pr);
  } else {
    if (flags.apply) {
      throw new Error('--apply needs --pr <number> or --setup.');
    }
    report(classify(localFiles(flags.base), publicModules()));
  }
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
