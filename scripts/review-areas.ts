/**
 * Review areas, tiers and risk (CONTRIBUTING.md, "Review areas and model tiers"). Every file in
 * the repository belongs to one review area, the strictest area of a pull request sets its review
 * tier, and `risk:high` raises that tier one step. The models and reviewers per tier are in
 * CONTRIBUTING.md only; this file decides which tier a change gets.
 *
 * Used by `review-labels.ts` (the PR labels workflow and `pnpm review:labels`), by `roadmap.ts`
 * (the `- **Area:**` line of a task file) and by `sync-roadmap.ts` (the area labels of task
 * issues). A change to this file raises `risk:high`: it decides how strictly other changes are
 * reviewed.
 */
import { posix } from 'node:path';

/** The review areas, as in the `area:*` labels. */
export const AREA_NAMES = [
  'core',
  'functions',
  'models',
  'spec',
  'tooling',
  'docs',
  'site',
] as const;

/** A review area. */
export type AreaName = (typeof AREA_NAMES)[number];

/** The review tiers, from the lightest to the strictest. */
export const TIERS = ['light', 'tooling', 'standard', 'core'] as const;

/** A review tier. CONTRIBUTING.md, "Model matrix", gives the worker and reviewers of each. */
export type Tier = (typeof TIERS)[number];

/** The tier of each area. Contracts (`spec`) are never a light tier. */
export const AREA_TIERS: Readonly<Record<AreaName, Tier>> = {
  core: 'core',
  functions: 'standard',
  models: 'standard',
  spec: 'standard',
  tooling: 'tooling',
  docs: 'light',
  site: 'light',
};

/** The label that raises the tier one step. */
export const RISK_LABEL = 'risk:high';

/** The label of an area, for example `area:core`. */
export function areaLabel(area: AreaName): string {
  return `area:${area}`;
}

const AREA_BY_LABEL: ReadonlyMap<string, AreaName> = new Map(
  AREA_NAMES.map((area) => [areaLabel(area), area]),
);

/** The area named by a label such as `area:core`, if it is one. */
export function areaOfLabel(label: string): AreaName | undefined {
  return AREA_BY_LABEL.get(label);
}

/** A label the review workflow uses, with the color and description it is created with. */
export interface LabelSpec {
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

const AREA_LABEL_COLOR = 'D4C5F9';

/** The review labels. GitHub allows at most 100 characters in a description. */
export const REVIEW_LABELS: readonly LabelSpec[] = [
  {
    name: 'area:core',
    color: AREA_LABEL_COLOR,
    description:
      'Review area: evaluator, parser, types, runtime, values and public API (core tier)',
  },
  {
    name: 'area:functions',
    color: AREA_LABEL_COLOR,
    description: 'Review area: the function library in packages/core/src/functions (standard tier)',
  },
  {
    name: 'area:models',
    color: AREA_LABEL_COLOR,
    description: 'Review area: fhir-r4, fhir-r5, fhir-r6, ucum and tools/model-gen (standard tier)',
  },
  {
    name: 'area:spec',
    color: AREA_LABEL_COLOR,
    description: 'Review area: tasks, spec notes, ADRs, roadmap and process rules (standard tier)',
  },
  {
    name: 'area:tooling',
    color: AREA_LABEL_COLOR,
    description: 'Review area: tools/conformance, scripts, .github and build config (tooling tier)',
  },
  {
    name: 'area:docs',
    color: AREA_LABEL_COLOR,
    description: 'Review area: READMEs, guides, other docs and examples (light tier)',
  },
  {
    name: 'area:site',
    color: AREA_LABEL_COLOR,
    description: 'Review area: the documentation site and playground in apps/site (light tier)',
  },
  {
    name: RISK_LABEL,
    color: 'B60205',
    description:
      'Raises the review tier one step (CONTRIBUTING.md, "Review areas and model tiers")',
  },
];

/** Paths of one area. */
interface AreaRule {
  readonly area: AreaName;
  readonly globs: readonly string[];
}

/**
 * The paths of each area. The first rule with a matching glob decides, so the more specific rules
 * come first. A glob's `*` matches within one path segment and `**` across segments. A test checks
 * that every file in the repository matches a rule and that every glob decides at least one file.
 */
export const AREA_RULES: readonly AreaRule[] = [
  // Contracts and process rules. Before the README rule below: docs/adr/README.md is the ADR index.
  {
    area: 'spec',
    globs: [
      'docs/tasks/**',
      'docs/adr/**',
      'docs/spec-notes.md',
      'docs/roadmap.md',
      'docs/architecture.md',
      '**/AGENTS.md',
      '**/CLAUDE.md',
      'CONTRIBUTING.md',
      'RELEASING.md',
      '.github/copilot-instructions.md',
    ],
  },
  // Documentation anywhere. Before the package rules: a package README is documentation.
  {
    area: 'docs',
    globs: [
      '**/README.md',
      '**/CHANGELOG.md',
      '**/LICENSE',
      '**/*LICENSE.md',
      '**/SOURCE.md',
      'docs/**',
      'examples/**',
    ],
  },
  { area: 'site', globs: ['apps/site/**'] },
  {
    area: 'models',
    globs: [
      'packages/fhir-r4/**',
      'packages/fhir-r5/**',
      'packages/fhir-r6/**',
      'packages/ucum/**',
      'tools/model-gen/**',
    ],
  },
  // How functions are declared and called is part of the compiler, not of the function library.
  { area: 'core', globs: ['packages/core/src/functions/define.ts'] },
  { area: 'functions', globs: ['packages/core/src/functions/**'] },
  { area: 'core', globs: ['packages/core/**'] },
  {
    area: 'tooling',
    globs: [
      'tools/conformance/**',
      'scripts/**',
      '.github/**',
      '.changeset/**',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'biome.json',
      'tsconfig.base.json',
      'vitest.config.ts',
      '.node-version',
      '.editorconfig',
      '.gitattributes',
      '.gitignore',
    ],
  },
];

const globCache = new Map<string, RegExp>();

/** Whether a repository path matches a glob (`*` within a segment, `**` across segments). */
export function matchesGlob(path: string, glob: string): boolean {
  let regExp = globCache.get(glob);
  if (regExp === undefined) {
    let source = '';
    for (let index = 0; index < glob.length; index++) {
      const char = glob.charAt(index);
      if (char !== '*') {
        source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
      } else if (glob.charAt(index + 1) !== '*') {
        source += '[^/]*';
      } else if (glob.charAt(index + 2) === '/') {
        // `**/` matches any number of directories, including none.
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    }
    regExp = new RegExp(`^${source}$`);
    globCache.set(glob, regExp);
  }
  return regExp.test(path);
}

function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}

/** The area of a path and the glob that decided it, or undefined when no rule matches. */
export function areaMatch(path: string): { area: AreaName; glob: string } | undefined {
  for (const rule of AREA_RULES) {
    const glob = rule.globs.find((candidate) => matchesGlob(path, candidate));
    if (glob !== undefined) {
      return { area: rule.area, glob };
    }
  }
  return undefined;
}

/** The area of a path, or undefined when the path is outside every area. */
export function areaOfPath(path: string): AreaName | undefined {
  return areaMatch(path)?.area;
}

function tierIndex(tier: Tier): number {
  return TIERS.indexOf(tier);
}

/** The strictest tier of the areas; `light` for none. */
export function strictestTier(areas: Iterable<AreaName>): Tier {
  let tier: Tier = 'light';
  for (const area of areas) {
    if (tierIndex(AREA_TIERS[area]) > tierIndex(tier)) {
      tier = AREA_TIERS[area];
    }
  }
  return tier;
}

/** How a file changed, as the GitHub API names it. */
export type FileStatus =
  | 'added'
  | 'removed'
  | 'modified'
  | 'renamed'
  | 'copied'
  | 'changed'
  | 'unchanged';

/** A file that a pull request or a branch changes. */
export interface ChangedFile {
  readonly path: string;
  /** The old path of a renamed or copied file. */
  readonly previousPath?: string;
  readonly status: FileStatus;
  readonly additions: number;
  readonly deletions: number;
  /**
   * The diff hunks, from the first `@@` line on. GitHub leaves it out for binary and very large
   * diffs; the rules then fall back to the line counts.
   */
  readonly patch?: string;
}

/** Why a change raises `risk:high`. */
export interface Risk {
  /** The file, or a description such as `(pull request)` when the reason is not one file. */
  readonly path: string;
  readonly reason: string;
}

/** The review areas, risk and tier of a change. */
export interface Classification {
  readonly areas: readonly AreaName[];
  /** Changed paths outside every area. Each also raises `risk:high`. */
  readonly unmapped: readonly string[];
  readonly risks: readonly Risk[];
  /** The strictest tier of the areas, before risk. */
  readonly baseTier: Tier;
  /** The tier after risk: one step above the base tier, and never above core. */
  readonly tier: Tier;
  /** Risk on a core change adds a second reviewer from the other vendor instead of a step. */
  readonly secondReviewer: boolean;
  /** The `area:*` labels, plus `risk:high` when there is a risk. */
  readonly labels: readonly string[];
}

const RELEASE_FILES = [
  '.github/workflows/release.yml',
  '.github/workflows/deploy.yml',
  '.changeset/config.json',
  '.changeset/pre.json',
];
const WORKFLOW_FILES = ['.github/workflows/**'];
const REVIEW_RULE_FILES = ['scripts/review-areas.ts', 'scripts/review-labels.ts'];
const DEPENDENCY_FILES = ['**/package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];
const ENTRY_POINTS = ['packages/*/src/index.ts'];
const BASELINE_FILE = 'tools/conformance/baseline.json';
const EXCEPTIONS_FILE = 'tools/conformance/src/exceptions.ts';
const TEST_CODE = ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/test/**/*.ts'];
const TEST_DATA = ['tools/conformance/fixtures/**', 'tools/conformance/suite/**'];
const TEST_CONFIG = ['**/vitest.config.ts', '**/vitest.*.config.ts', '**/playwright.config.ts'];

/** A test case or an assertion in a line of test code; `regex.test(…)` is neither. */
const TEST_CASE = /(?<![\w$.])(?:it|test|bench|expect|expectTypeOf|assert)(?:\.\w+)*\(/g;
/** A test that is skipped, focused (which skips the others) or only planned. */
const TEST_SKIP = /(?<![\w$.])(?:it|test|describe|bench)\.(?:skip|only|todo|fails|skipIf|runIf)\b/;

/** The added and removed lines of a patch, without their `+` or `-`. */
export function patchLines(patch: string): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('+')) {
      added.push(line.slice(1));
    } else if (line.startsWith('-')) {
      removed.push(line.slice(1));
    }
  }
  return { added, removed };
}

function countTestCases(lines: readonly string[]): number {
  return lines.reduce((count, line) => count + (line.match(TEST_CASE)?.length ?? 0), 0);
}

/**
 * Baseline entries that a patch removes and does not add back. Moving the last entry's comma
 * removes and re-adds a line, so entries are compared without their comma.
 */
export function removedBaselineEntries(patch: string): string[] {
  const entry = (line: string) => line.trim().replace(/,$/, '');
  const { added, removed } = patchLines(patch);
  const kept = new Set(added.map(entry));
  return removed.map(entry).filter((line) => line !== '' && !kept.has(line));
}

/** Why a change to test code removes or weakens tests, if it does. */
function testCodeRisk(file: ChangedFile): string | undefined {
  if (file.status === 'removed') {
    return 'removes a test file';
  }
  if (!matchesAny(file.path, TEST_CODE)) {
    return 'moves a test file out of the tests';
  }
  if (file.patch === undefined) {
    return file.deletions > file.additions
      ? 'shrinks a test file (GitHub shows no diff to inspect)'
      : undefined;
  }
  const { added, removed } = patchLines(file.patch);
  if (added.some((line) => TEST_SKIP.test(line))) {
    return 'skips, focuses or plans tests (.skip, .only, .todo, …)';
  }
  const before = countTestCases(removed);
  const after = countTestCases(added);
  return before > after
    ? `removes more test cases and assertions (${before}) than it adds (${after})`
    : undefined;
}

function filePaths(file: ChangedFile): string[] {
  return file.previousPath === undefined ? [file.path] : [file.previousPath, file.path];
}

/** Whether a file is test code before and after the change. */
export function isTestCode(file: ChangedFile): boolean {
  return filePaths(file).every((path) => matchesAny(path, TEST_CODE));
}

/** The risks of one changed file. */
function fileRisks(file: ChangedFile, publicModules: ReadonlySet<string>): Risk[] {
  const risks: Risk[] = [];
  const paths = filePaths(file);
  const add = (reason: string) => risks.push({ path: file.path, reason });
  const touches = (globs: readonly string[]) => paths.some((path) => matchesAny(path, globs));

  if (touches(RELEASE_FILES)) {
    add('release workflow or changeset configuration');
  } else if (touches(WORKFLOW_FILES)) {
    add('CI workflow: its permissions, secrets and what it runs');
  }
  if (touches(REVIEW_RULE_FILES)) {
    add('review areas and risk rules');
  }
  if (touches(DEPENDENCY_FILES)) {
    add('dependencies or package manifest');
  }
  if (touches(ENTRY_POINTS)) {
    add('public exports: a package entry point');
  } else if (paths.some((path) => publicModules.has(path))) {
    add('public API: a module that a package entry point re-exports');
  }
  if (paths.includes(BASELINE_FILE)) {
    const removed = file.patch === undefined ? [] : removedBaselineEntries(file.patch);
    if (
      file.status === 'removed' ||
      removed.length > 0 ||
      (file.patch === undefined && file.deletions > 0)
    ) {
      add('lowers the conformance baseline');
    }
  }
  if (paths.includes(EXCEPTIONS_FILE)) {
    add('conformance exceptions: they skip suite tests');
  }
  const testRisk = touches(TEST_CODE) ? testCodeRisk(file) : undefined;
  if (testRisk !== undefined) {
    add(testRisk);
  }
  if (touches(TEST_DATA) && (file.status === 'removed' || file.deletions > file.additions)) {
    add('removes test fixtures');
  }
  if (touches(TEST_CONFIG)) {
    add('test configuration: it decides which tests run');
  }
  return risks;
}

/**
 * The modules that a package entry point re-exports, as repository paths. Only
 * `export … from './…'` statements count: an entry point's imports are implementation.
 */
export function reExportedModules(entryPoint: string, source: string): string[] {
  const directory = posix.dirname(entryPoint);
  const modules: string[] = [];
  for (const match of source.matchAll(/^export\b[^;]*?\bfrom\s+'(\.\.?\/[^']+)'/gm)) {
    const specifier = match[1];
    if (specifier !== undefined) {
      modules.push(posix.join(directory, specifier));
    }
  }
  return modules;
}

/**
 * Classifies a change: its areas from the paths, its risks, and the resulting tier and labels.
 *
 * Test code follows the code it tests: it counts toward the areas only when the change touches
 * nothing but tests. A function PR that adds cases to the shared tests in `packages/core/test/`
 * therefore stays in `area:functions`. Removing or weakening a test raises `risk:high` instead.
 *
 * @param publicModules Modules that package entry points re-export ({@link reExportedModules}).
 * @param extraRisks Risks found outside the files, such as an incomplete file list.
 */
export function classify(
  files: readonly ChangedFile[],
  publicModules: ReadonlySet<string> = new Set(),
  extraRisks: readonly Risk[] = [],
): Classification {
  const code = files.filter((file) => !isTestCode(file));
  const areaFiles = new Set(code.length > 0 ? code : files);
  const found = new Set<AreaName>();
  const unmapped: string[] = [];
  const risks: Risk[] = [...extraRisks];
  for (const file of files) {
    for (const path of filePaths(file)) {
      const area = areaOfPath(path);
      if (area === undefined) {
        unmapped.push(path);
        risks.push({
          path,
          reason: 'outside every review area: add it to scripts/review-areas.ts',
        });
      } else if (areaFiles.has(file)) {
        found.add(area);
      }
    }
    risks.push(...fileRisks(file, publicModules));
  }

  const areas = AREA_NAMES.filter((area) => found.has(area));
  const baseTier = strictestTier(areas);
  const risky = risks.length > 0;
  const tier = risky
    ? (TIERS[Math.min(tierIndex(baseTier) + 1, TIERS.length - 1)] ?? baseTier)
    : baseTier;
  return {
    areas,
    unmapped,
    risks,
    baseTier,
    tier,
    secondReviewer: risky && baseTier === 'core',
    labels: [...areas.map(areaLabel), ...(risky ? [RISK_LABEL] : [])],
  };
}
