import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AREA_NAMES,
  AREA_RULES,
  AREA_TIERS,
  type AreaName,
  areaLabel,
  areaMatch,
  areaOfLabel,
  areaOfPath,
  type ChangedFile,
  classify,
  matchesGlob,
  REVIEW_LABELS,
  RISK_LABEL,
  reExportedModules,
  removedBaselineEntries,
} from './review-areas.ts';

// The rules come from CONTRIBUTING.md, "Review areas and model tiers".

const root = fileURLToPath(new URL('..', import.meta.url));

function modified(path: string, patch?: string, counts = { additions: 1, deletions: 1 }) {
  return {
    path,
    status: 'modified',
    ...counts,
    ...(patch === undefined ? {} : { patch }),
  } satisfies ChangedFile;
}

function reasons(files: readonly ChangedFile[], publicModules?: ReadonlySet<string>): string[] {
  return classify(files, publicModules).risks.map((risk) => `${risk.path}: ${risk.reason}`);
}

describe('the areas of the repository', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path !== '');

  it('put every tracked file in an area', () => {
    expect(tracked.length).toBeGreaterThan(100);
    expect(tracked.filter((path) => areaOfPath(path) === undefined)).toEqual([]);
  });

  it('have no glob that decides no file, so none is dead or shadowed', () => {
    const deciding = new Set(tracked.map((path) => JSON.stringify(areaMatch(path))));
    const unused = AREA_RULES.flatMap((rule) =>
      rule.globs
        .filter((glob) => !deciding.has(JSON.stringify({ area: rule.area, glob })))
        .map((glob) => `${rule.area}: ${glob}`),
    );
    expect(unused).toEqual([]);
  });

  it.each<[string, AreaName]>([
    ['packages/core/src/compiler/compile.ts', 'core'],
    ['packages/core/src/parser/parser.ts', 'core'],
    ['packages/core/src/runtime/navigation.ts', 'core'],
    ['packages/core/src/values/decimal/decimal.ts', 'core'],
    ['packages/core/src/index.ts', 'core'],
    ['packages/core/src/fhir/extension.ts', 'core'],
    ['packages/core/test/public-api.test.ts', 'core'],
    ['packages/core/package.json', 'core'],
    ['packages/core/src/functions/define.ts', 'core'],
    ['packages/core/src/functions/registry.ts', 'functions'],
    ['packages/core/src/functions/existence.ts', 'functions'],
    ['packages/fhir-r6/src/model-data.ts', 'models'],
    ['packages/ucum/src/unit-table.ts', 'models'],
    ['tools/model-gen/src/generate.ts', 'models'],
    ['docs/tasks/T0013-fn-subsetting-combining.md', 'spec'],
    ['docs/adr/README.md', 'spec'],
    ['docs/spec-notes.md', 'spec'],
    ['docs/roadmap.md', 'spec'],
    ['AGENTS.md', 'spec'],
    ['CONTRIBUTING.md', 'spec'],
    ['tools/conformance/baseline.json', 'tooling'],
    ['scripts/sync-roadmap.ts', 'tooling'],
    ['.github/workflows/ci.yml', 'tooling'],
    ['pnpm-lock.yaml', 'tooling'],
    ['README.md', 'docs'],
    ['packages/core/README.md', 'docs'],
    ['packages/ucum/UCUM-LICENSE.md', 'docs'],
    ['docs/guides/testing.md', 'docs'],
    ['examples/public-api.ts', 'docs'],
    ['apps/site/app/root.tsx', 'site'],
  ])('put %s in area:%s', (path, area) => {
    expect(areaOfPath(path)).toBe(area);
  });

  it('leave a path outside every area unmapped', () => {
    expect(areaOfPath('packages/cli/src/index.ts')).toBeUndefined();
    expect(areaOfPath('notes.txt')).toBeUndefined();
  });
});

describe('globs', () => {
  it.each([
    ['docs/tasks/**', 'docs/tasks/T0001-lexer.md', true],
    ['docs/tasks/**', 'docs/tasks.md', false],
    ['**/README.md', 'README.md', true],
    ['**/README.md', 'packages/core/README.md', true],
    ['**/README.md', 'packages/core/README.mdx', false],
    ['packages/*/src/index.ts', 'packages/core/src/index.ts', true],
    ['packages/*/src/index.ts', 'packages/core/src/api/index.ts', false],
    ['**/*LICENSE.md', 'packages/ucum/UCUM-LICENSE.md', true],
    ['.github/**', '.github/workflows/ci.yml', true],
    ['package.json', 'packages/core/package.json', false],
  ])('%s matches %s: %s', (glob, path, expected) => {
    expect(matchesGlob(path, glob)).toBe(expected);
  });
});

describe('labels', () => {
  it('define one label per area and the risk label, each short enough for GitHub', () => {
    expect(REVIEW_LABELS.map((label) => label.name)).toEqual([
      ...AREA_NAMES.map(areaLabel),
      RISK_LABEL,
    ]);
    for (const label of REVIEW_LABELS) {
      expect(label.description.length).toBeLessThanOrEqual(100);
      expect(label.color).toMatch(/^[0-9A-F]{6}$/);
    }
  });

  it('read an area back from its label', () => {
    expect(areaOfLabel('area:functions')).toBe('functions');
    expect(areaOfLabel('area:other')).toBeUndefined();
    expect(areaOfLabel('wave-1')).toBeUndefined();
  });
});

describe('tiers', () => {
  it('never put contracts in the light tier', () => {
    expect(AREA_TIERS.spec).toBe('standard');
  });

  it('take the strictest tier of the areas', () => {
    const result = classify([
      modified('docs/guide.md'),
      modified('packages/core/src/functions/existence.ts'),
    ]);
    expect(result.areas).toEqual(['functions', 'docs']);
    expect(result.labels).toEqual(['area:functions', 'area:docs']);
    expect(result.tier).toBe('standard');
    expect(result.secondReviewer).toBe(false);
  });

  it.each([
    ['README.md', 'light', 'tooling'],
    ['scripts/report-size.ts', 'tooling', 'standard'],
    ['packages/core/src/functions/existence.ts', 'standard', 'core'],
    ['packages/core/src/runtime/equality.ts', 'core', 'core'],
  ])('raise %s from %s to %s with risk:high', (path, baseTier, tier) => {
    const result = classify([modified(path)], new Set(), [{ path, reason: 'set by hand' }]);
    expect(result.labels).toContain(RISK_LABEL);
    expect(result.baseTier).toBe(baseTier);
    expect(result.tier).toBe(tier);
    expect(result.secondReviewer).toBe(baseTier === 'core');
  });

  // A function PR extends the shared core tests; the tests follow the code they test.
  it('let test code follow the code it tests, unless the change is only tests', () => {
    const test = modified('packages/core/test/public-docs.test.ts', '+  it("works", () => {});');
    const functionChange = classify([modified('packages/core/src/functions/subsetting.ts'), test]);
    expect(functionChange.areas).toEqual(['functions']);
    expect(functionChange.tier).toBe('standard');
    expect(classify([test]).areas).toEqual(['core']);
  });
});

describe('risk', () => {
  it('flags public exports and the modules that entry points re-export', () => {
    const publicModules = new Set(['packages/core/src/values/decimal/decimal.ts']);
    expect(
      reasons(
        [
          modified('packages/fhir-r4/src/index.ts'),
          modified('packages/core/src/values/decimal/decimal.ts'),
          modified('packages/core/src/runtime/equality.ts'),
        ],
        publicModules,
      ),
    ).toEqual([
      'packages/fhir-r4/src/index.ts: public exports: a package entry point',
      'packages/core/src/values/decimal/decimal.ts: public API: a module that a package entry point re-exports',
    ]);
  });

  it('finds the re-exported modules of an entry point, but not its imports', () => {
    const source = [
      "import { modelData } from './model-data.ts';",
      "export type { PlainQuantity } from './api/output.ts';",
      'export {',
      '  FhirPathError,',
      "} from './errors/fhirpath-error.ts';",
      "export { ucum } from '../shared/ucum.ts';",
    ].join('\n');
    expect(reExportedModules('packages/core/src/index.ts', source)).toEqual([
      'packages/core/src/api/output.ts',
      'packages/core/src/errors/fhirpath-error.ts',
      'packages/core/shared/ucum.ts',
    ]);
    const core = readFileSync(new URL('../packages/core/src/index.ts', import.meta.url), 'utf8');
    expect(reExportedModules('packages/core/src/index.ts', core)).toContain(
      'packages/core/src/api/public-api.ts',
    );
  });

  it.each([
    ['.github/workflows/release.yml', 'release workflow or changeset configuration'],
    ['.changeset/pre.json', 'release workflow or changeset configuration'],
    ['.github/workflows/ci.yml', 'CI workflow: its permissions, secrets and what it runs'],
    ['scripts/review-areas.ts', 'review areas and risk rules'],
    ['apps/site/package.json', 'dependencies or package manifest'],
    ['pnpm-workspace.yaml', 'dependencies or package manifest'],
    ['tools/conformance/src/exceptions.ts', 'conformance exceptions: they skip suite tests'],
    ['tools/conformance/vitest.suite.config.ts', 'test configuration: it decides which tests run'],
  ])('flags %s', (path, reason) => {
    expect(reasons([modified(path)])).toEqual([`${path}: ${reason}`]);
  });

  it('flags a path outside every area', () => {
    const result = classify([modified('packages/cli/src/index.ts')]);
    expect(result.unmapped).toEqual(['packages/cli/src/index.ts']);
    expect(result.labels).toEqual([RISK_LABEL]);
    expect(reasons([modified('notes.txt')])).toEqual([
      'notes.txt: outside every review area: add it to scripts/review-areas.ts',
    ]);
  });

  it('flags a renamed file by its old path too', () => {
    const moved = {
      ...modified('scripts/old-release.yml'),
      status: 'renamed',
      previousPath: '.github/workflows/release.yml',
    } satisfies ChangedFile;
    expect(reasons([moved])).toContain(
      'scripts/old-release.yml: release workflow or changeset configuration',
    );
    expect(classify([moved]).areas).toEqual(['tooling']);
  });

  describe('the conformance baseline', () => {
    const path = 'tools/conformance/baseline.json';

    it('accepts new passing tests, also when the last entry gets a comma', () => {
      const patch = [
        '@@ -10,3 +10,5 @@',
        '     "testA",',
        '-    "testB"',
        '+    "testB",',
        '+    "testC"',
        '   ],',
      ].join('\n');
      expect(removedBaselineEntries(patch)).toEqual([]);
      expect(reasons([modified(path, patch)])).toEqual([]);
    });

    it('flags a removed entry, a patch it cannot inspect and a deleted baseline', () => {
      const patch = '@@ -10,3 +10,2 @@\n     "testA",\n-    "testB",\n     "testC"';
      expect(removedBaselineEntries(patch)).toEqual(['"testB"']);
      const lowered = `${path}: lowers the conformance baseline`;
      expect(reasons([modified(path, patch)])).toEqual([lowered]);
      expect(reasons([modified(path, undefined, { additions: 9, deletions: 1 })])).toEqual([
        lowered,
      ]);
      expect(reasons([{ ...modified(path), status: 'removed' }])).toEqual([lowered]);
    });
  });

  describe('tests', () => {
    const path = 'packages/core/src/runtime/equality.test.ts';

    it('accept added cases and moved assertions', () => {
      const added = '@@ -1 +1,3 @@\n+  it("a", () => {\n+    expect(a).toBe(1);\n+  });';
      const moved =
        '@@ -1,2 +1,2 @@\n-  expect(a).toBe(1);\n-  expect(b).toBe(2);\n+  expect(b).toBe(2);\n+  expect(a).toBe(1);';
      const regex = '@@ -1 +1 @@\n-    if (PATTERN.test(value)) {\n+    if (OTHER.test(value)) {';
      expect(
        reasons([modified(path, added), modified(path, moved), modified(path, regex)]),
      ).toEqual([]);
    });

    it.each([
      [
        'fewer cases',
        '@@ -1,3 +1 @@\n-  it("a", () => {\n-    expect(a).toBe(1);\n-  });\n+  // later',
        'removes more test cases and assertions (2) than it adds (0)',
      ],
      [
        'a skipped case',
        '@@ -1 +1 @@\n-  it("a", () => {\n+  it.skip("a", () => {',
        'skips, focuses or plans tests (.skip, .only, .todo, …)',
      ],
      [
        'a focused case',
        '@@ -1 +1 @@\n-  describe("a", () => {\n+  describe.only("a", () => {',
        'skips, focuses or plans tests (.skip, .only, .todo, …)',
      ],
    ])('flag %s', (_name, patch, reason) => {
      expect(reasons([modified(path, patch)])).toEqual([`${path}: ${reason}`]);
    });

    it('flag a deleted test file, one moved out of the tests and one that shrinks unseen', () => {
      expect(reasons([{ ...modified(path), status: 'removed' }])).toEqual([
        `${path}: removes a test file`,
      ]);
      const outOfTests = {
        ...modified('packages/core/src/runtime/equality-cases.ts'),
        status: 'renamed',
        previousPath: path,
      } satisfies ChangedFile;
      expect(reasons([outOfTests])).toEqual([
        'packages/core/src/runtime/equality-cases.ts: moves a test file out of the tests',
      ]);
      expect(reasons([modified(path, undefined, { additions: 1, deletions: 5 })])).toEqual([
        `${path}: shrinks a test file (GitHub shows no diff to inspect)`,
      ]);
    });

    it('flag removed or shrinking conformance fixtures', () => {
      const fixture = 'tools/conformance/fixtures/r4/patient-example.json';
      expect(reasons([modified(fixture, undefined, { additions: 1, deletions: 3 })])).toEqual([
        `${fixture}: removes test fixtures`,
      ]);
      expect(reasons([modified(fixture, undefined, { additions: 3, deletions: 1 })])).toEqual([]);
    });
  });

  it('include risks found outside the files', () => {
    const result = classify([modified('README.md')], new Set(), [
      { path: '(pull request)', reason: 'GitHub listed 3000 of its 3001 changed files' },
    ]);
    expect(result.labels).toEqual(['area:docs', RISK_LABEL]);
    expect(result.tier).toBe('tooling');
  });
});
