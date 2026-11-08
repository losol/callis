/**
 * The pre-1.0 rule for changesets from CONTRIBUTING.md ("Changesets"): never `major` before 1.0.
 * Changesets takes a 0.x package with a `major` changeset straight to 1.0.0, and npm never takes a
 * version back. `check-changesets.ts` runs this check in `pnpm check` and CI.
 *
 * The files are read the way the release reads them: the file selection of `@changesets/read`
 * 1.0.1 and its parser, `@changesets/parse` 1.0.0, the versions that `@changesets/cli` 3.0.3 uses.
 * Changesets 3 bumps a dependent by `patch` at most, so a 0.x package only gets `major` from a
 * changeset that names it. Once a package is at 1.0 or above, a `fixed` or `linked` group could pass
 * its `major` on to a 0.x package; `.changeset/config.json` has no such groups.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseChangesetFile } from '@changesets/parse';

/** A changeset that breaks the rule, or that the check cannot verify. */
export interface ChangesetProblem {
  /**
   * - `major-before-1.0`: a `major` bump for a package below 1.0.0.
   * - `unknown-package`: a package that is not in the workspace, so its version is unknown.
   *   Changesets rejects such a changeset when it versions the packages.
   * - `unreadable`: a file that Changesets cannot parse, so its bumps are unknown.
   */
  readonly kind: 'major-before-1.0' | 'unknown-package' | 'unreadable';
  /** The changeset file, relative to the repository root, for example `.changeset/brave-cats.md`. */
  readonly file: string;
  /** The package the problem is about; absent when the file cannot be read. */
  readonly packageName?: string;
  /** What is wrong and what to do, for people. */
  readonly message: string;
}

/** The workspace packages by name, with the `version` from each package's `package.json`. */
export type WorkspaceVersions = ReadonlyMap<string, string | undefined>;

/** The Markdown files that `@changesets/read` 1.0.1 does not read as changesets. */
const IGNORED_FILES: readonly (string | RegExp)[] = [
  /^README\.md$/i,
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
];

/** Whether Changesets reads a file in `.changeset/` or `.changeset/pre/` as a changeset. */
export function isChangesetFile(fileName: string): boolean {
  return (
    !fileName.startsWith('.') &&
    fileName.endsWith('.md') &&
    !IGNORED_FILES.some((ignored) =>
      typeof ignored === 'string' ? ignored === fileName : ignored.test(fileName),
    )
  );
}

/**
 * The changeset files under `root`, relative to it and sorted. Changesets reads `.changeset/` and
 * `.changeset/pre/`, where prerelease mode keeps the changesets it has used.
 */
export function listChangesetFiles(root: string): string[] {
  const files: string[] = [];
  for (const dir of ['.changeset', '.changeset/pre']) {
    if (dir === '.changeset/pre' && !existsSync(join(root, dir))) {
      continue;
    }
    for (const name of readdirSync(join(root, dir))) {
      if (isChangesetFile(name)) {
        files.push(`${dir}/${name}`);
      }
    }
  }
  return files.sort();
}

/**
 * The `packages` entries of a `pnpm-workspace.yaml`, in the block-list form this repository uses.
 * Anything else in that list throws, so the check never runs on a partial package list.
 */
export function parseWorkspaceGlobs(yaml: string): string[] {
  const globs: string[] = [];
  let inPackages = false;
  for (const line of yaml.split(/\r?\n/)) {
    // A blank or comment line, also at column 0, does not end the list.
    if (/^\s*(?:#.*)?$/.test(line)) {
      continue;
    }
    if (/^packages:\s*(?:#.*)?$/.test(line)) {
      inPackages = true;
    } else if (/^\S/.test(line)) {
      inPackages = false;
    } else if (inPackages) {
      const entry = /^\s+-\s+(['"]?)([^'"\s#]+)\1\s*(?:#.*)?$/.exec(line)?.[2];
      if (entry === undefined) {
        throw new Error(
          `pnpm-workspace.yaml: cannot read the packages entry ${JSON.stringify(line)}`,
        );
      }
      globs.push(entry);
    }
  }
  return globs;
}

/**
 * The version of every workspace package, from the `packages` globs in `pnpm-workspace.yaml`.
 * A glob is a directory (`tools/cli`) or the directories in one (`packages/*`); a directory without
 * a `package.json` is not a package. Other globs throw, so no package is left out unnoticed.
 */
export function readWorkspaceVersions(root: string): WorkspaceVersions {
  const globs = parseWorkspaceGlobs(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'));
  if (globs.length === 0) {
    throw new Error('pnpm-workspace.yaml: found no packages entries');
  }
  const versions = new Map<string, string | undefined>();
  for (const glob of globs) {
    const parts = /^((?:[\w.-]+\/)*[\w.-]+)(\/\*)?$/.exec(glob);
    if (parts?.[1] === undefined) {
      throw new Error(
        `pnpm-workspace.yaml: the check does not support the glob ${JSON.stringify(glob)}`,
      );
    }
    const base = parts[1];
    const dirs =
      parts[2] === undefined
        ? [base]
        : readdirSync(join(root, base), { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => `${base}/${entry.name}`);
    for (const dir of dirs) {
      const manifestPath = join(root, dir, 'package.json');
      if (existsSync(manifestPath)) {
        const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
        const name = ownString(manifest, 'name');
        if (name !== undefined) {
          versions.set(name, ownString(manifest, 'version'));
        }
      }
    }
  }
  return versions;
}

/**
 * Whether a version is below 1.0.0: a 0.x version, including a 0.x prerelease such as
 * `0.3.0-next.0`, or no valid version at all. `1.0.0-next.0` counts as 1.0: getting there was the
 * deliberate 1.0 decision.
 */
export function isBelowOne(version: string | undefined): boolean {
  return version === undefined || !/^[1-9]\d*\.\d+\.\d+(?:[-+].*)?$/.test(version);
}

/**
 * Checks one changeset against the workspace versions. It fails on a `major` bump for a package
 * below 1.0.0, on a package outside the workspace and on a file that Changesets cannot parse.
 */
export function checkChangeset(
  file: string,
  contents: string,
  versions: WorkspaceVersions,
): ChangesetProblem[] {
  let releases: ReturnType<typeof parseChangesetFile>['releases'];
  try {
    releases = parseChangesetFile(contents).releases;
  } catch (error) {
    return [
      {
        kind: 'unreadable',
        file,
        message: `${file}: Changesets cannot read it (${summarizeParseError(error)}). Write one line per package, such as '@callis/core': minor, with the name in quotes.`,
      },
    ];
  }

  const problems: ChangesetProblem[] = [];
  for (const { name, type } of releases) {
    if (!versions.has(name)) {
      problems.push({
        kind: 'unknown-package',
        file,
        packageName: name,
        message: `${file}: ${name} is not a package in this workspace, so its version is unknown. Check the name.`,
      });
    } else if (type === 'major') {
      const version = versions.get(name);
      if (isBelowOne(version)) {
        problems.push({
          kind: 'major-before-1.0',
          file,
          packageName: name,
          message: `${file}: "major" for ${name} ${version ?? '(no version)'} would take it to 1.0.0. Before 1.0, use "minor", also for a breaking change.`,
        });
      }
    }
  }
  return problems;
}

/** The first line of a `@changesets/parse` error, and the YAML error when there is one. */
function summarizeParseError(error: unknown): string {
  const lines = (error instanceof Error ? error.message : String(error)).split('\n');
  // The YAML error line ends with a colon before the excerpt that follows it.
  const yamlError = lines.find((line) => line.startsWith('YAML error:'))?.replace(/:$/, '');
  return [lines[0], yamlError].filter((line) => line !== undefined && line !== '').join(' ');
}

/** A string property of parsed JSON, read through an own-property check. */
function ownString(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) {
    return undefined;
  }
  const property: unknown = Reflect.get(value, key);
  return typeof property === 'string' ? property : undefined;
}
