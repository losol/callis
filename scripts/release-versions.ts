/**
 * The release guard from RELEASING.md: the release workflow never publishes a version below 0.1.0.
 *
 * Until its first release, a package's name on npm holds only a deprecated placeholder, 0.0.1, and
 * its version in the repository is 0.0.0. A lower version can therefore only reach `changeset
 * publish` by mistake, for example in a release run with no changesets pending.
 */

/** The lowest version the release workflow may publish. */
export const MINIMUM_RELEASE_VERSION = '0.1.0';

/** A workspace project, as `pnpm ls --recursive --json` lists it. */
export interface WorkspaceProject {
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
  readonly path: string;
}

/** A public workspace project whose version must not be published. */
export interface ReleaseVersionProblem {
  readonly name: string;
  readonly version: string | undefined;
  readonly reason: string;
}

interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: boolean;
}

// SemVer 2.0.0: MAJOR.MINOR.PATCH, an optional prerelease and optional build metadata.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(version: string): ParsedVersion | undefined {
  const match = SEMVER.exec(version);
  if (match === null) {
    return undefined;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] !== undefined,
  };
}

/**
 * Whether `version` comes before `minimum` in SemVer order. A prerelease of `minimum`, such as
 * `0.1.0-next.0`, comes before it.
 */
export function isBelowVersion(version: string, minimum: string): boolean {
  const actual = parseVersion(version);
  const bound = parseVersion(minimum);
  if (actual === undefined || bound === undefined) {
    throw new Error(
      `Not a valid version: ${JSON.stringify(actual === undefined ? version : minimum)}`,
    );
  }
  for (const part of ['major', 'minor', 'patch'] as const) {
    if (actual[part] !== bound[part]) {
      return actual[part] < bound[part];
    }
  }
  return actual.prerelease && !bound.prerelease;
}

/**
 * The public projects that the release workflow must not publish: those with a missing or invalid
 * version, or a version below `minimum`. Private projects are never published, so they are skipped.
 */
export function findReleaseVersionProblems(
  projects: readonly WorkspaceProject[],
  minimum: string = MINIMUM_RELEASE_VERSION,
): ReleaseVersionProblem[] {
  const problems: ReleaseVersionProblem[] = [];
  for (const project of projects) {
    if (project.private === true) {
      continue;
    }
    const name = project.name ?? project.path;
    const { version } = project;
    if (version === undefined) {
      problems.push({ name, version, reason: 'has no version' });
    } else if (parseVersion(version) === undefined) {
      problems.push({
        name,
        version,
        reason: `has an invalid version, ${JSON.stringify(version)}`,
      });
    } else if (isBelowVersion(version, minimum)) {
      problems.push({ name, version, reason: `is at ${version}, below ${minimum}` });
    }
  }
  return problems;
}
