import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkChangeset,
  isBelowOne,
  isChangesetFile,
  listChangesetFiles,
  parseWorkspaceGlobs,
  readWorkspaceVersions,
  type WorkspaceVersions,
} from './changesets.ts';

// CONTRIBUTING.md, "Changesets": "Never use `major` before 1.0: it would release 1.0.0."

const versions: WorkspaceVersions = new Map([
  ['@callis/core', '0.2.0'],
  ['@callis/ucum', '0.1.1'],
  ['@callis/new', '0.0.0'],
  ['callis-plain', '0.4.0'],
  ['@callis/prerelease', '0.3.0-next.0'],
  ['@callis/unversioned', undefined],
  ['@callis/stable', '1.0.0'],
  ['@callis/later', '2.3.4'],
  ['@callis/one-next', '1.0.0-next.0'],
]);

const FILE = '.changeset/brave-cats.md';

/** A changeset file with the given frontmatter lines. */
function changeset(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n\nA summary for the users of the package.\n`;
}

/** The kind and package of each problem, so tests assert on those and not on message text. */
function problemsOf(contents: string): [string, string | undefined][] {
  return checkChangeset(FILE, contents, versions).map((problem) => [
    problem.kind,
    problem.packageName,
  ]);
}

describe('checkChangeset', () => {
  it.each([
    ["'@callis/core': major", '@callis/core'],
    ["'@callis/new': major", '@callis/new'],
    ["'@callis/prerelease': major", '@callis/prerelease'],
    ["'@callis/unversioned': major", '@callis/unversioned'],
  ])('rejects %s for a package below 1.0.0', (frontmatter, packageName) => {
    expect(problemsOf(changeset(frontmatter))).toEqual([['major-before-1.0', packageName]]);
  });

  it.each([
    "'@callis/core': minor",
    "'@callis/core': patch",
    "'@callis/core': none",
    "'@callis/new': minor",
  ])('accepts %s', (frontmatter) => {
    expect(problemsOf(changeset(frontmatter))).toEqual([]);
  });

  it.each(["'@callis/stable': major", "'@callis/later': major", "'@callis/one-next': major"])(
    'accepts %s for a package at 1.0.0 or above',
    (frontmatter) => {
      expect(problemsOf(changeset(frontmatter))).toEqual([]);
    },
  );

  it.each([
    ["'@callis/core': major", '@callis/core'],
    ['"@callis/core": major', '@callis/core'],
    ["'@callis/core': 'major'", '@callis/core'],
    ['callis-plain: major', 'callis-plain'],
    ["'@callis/core': major # a comment", '@callis/core'],
    ["{ '@callis/core': major }", '@callis/core'],
  ])('reads the package name in %s', (frontmatter, packageName) => {
    expect(problemsOf(changeset(frontmatter))).toEqual([['major-before-1.0', packageName]]);
  });

  it('reads a file with Windows line endings', () => {
    const contents = changeset("'@callis/core': major").replaceAll('\n', '\r\n');
    expect(problemsOf(contents)).toEqual([['major-before-1.0', '@callis/core']]);
  });

  it('reports every package below 1.0.0 with a major bump, and only those', () => {
    const contents = changeset(
      ["'@callis/core': major", "'@callis/ucum': major", "'@callis/stable': major"].join('\n'),
    );
    expect(problemsOf(contents)).toEqual([
      ['major-before-1.0', '@callis/core'],
      ['major-before-1.0', '@callis/ucum'],
    ]);
  });

  it('names the file and the package, and suggests minor', () => {
    const [problem] = checkChangeset(FILE, changeset("'@callis/core': major"), versions);
    expect(problem?.file).toBe(FILE);
    expect(problem?.message).toContain(FILE);
    expect(problem?.message).toContain('@callis/core');
    expect(problem?.message).toContain('"minor"');
  });

  it.each(["'@callis/missing': patch", "'@callis/missing': major"])(
    'rejects %s, a package outside the workspace',
    (frontmatter) => {
      expect(problemsOf(changeset(frontmatter))).toEqual([['unknown-package', '@callis/missing']]);
    },
  );

  it.each([
    // YAML reserves @, so an unquoted scoped name is invalid YAML; Changesets cannot read it either.
    ['an unquoted scoped name', changeset('@callis/core: major')],
    ['an unknown bump type', changeset("'@callis/core': Major")],
    ['a duplicate package', changeset("'@callis/core': minor\n'@callis/core': major")],
    ['no frontmatter', 'A summary without frontmatter.\n'],
    ['an empty file', ''],
  ])('rejects a file it cannot read: %s', (_, contents) => {
    expect(problemsOf(contents)).toEqual([['unreadable', undefined]]);
  });

  it('accepts a changeset without packages', () => {
    expect(problemsOf('---\n---\n\nNothing to release.\n')).toEqual([]);
  });
});

describe('isBelowOne', () => {
  it.each([
    ['0.0.0', true],
    ['0.2.0', true],
    ['0.3.0-next.0', true],
    ['', true],
    ['not a version', true],
    [undefined, true],
    ['1.0.0', false],
    ['1.0.0-next.0', false],
    ['10.2.3', false],
  ])('%j is below 1.0.0: %s', (version, expected) => {
    expect(isBelowOne(version)).toBe(expected);
  });
});

// The file selection of @changesets/read 1.0.1.
describe('isChangesetFile', () => {
  it.each([
    ['brave-cats.md', true],
    ['README.md', false],
    ['readme.md', false],
    ['AGENTS.md', false],
    ['CLAUDE.md', false],
    ['GEMINI.md', false],
    ['.draft.md', false],
    ['config.json', false],
    ['pre.json', false],
    ['pre', false],
  ])('%s: %s', (fileName, expected) => {
    expect(isChangesetFile(fileName)).toBe(expected);
  });
});

describe('reading the repository', () => {
  const temporaryDirs: string[] = [];

  afterEach(() => {
    for (const path of temporaryDirs.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  /** A temporary repository with the given files, by path. */
  function repository(files: Readonly<Record<string, string>>): string {
    const root = mkdtempSync(join(tmpdir(), 'callis-changesets-'));
    temporaryDirs.push(root);
    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), contents);
    }
    return root;
  }

  it('lists the changesets in .changeset/ and .changeset/pre/', () => {
    const root = repository({
      '.changeset/README.md': '# Changesets\n',
      '.changeset/config.json': '{}\n',
      '.changeset/pre.json': '{}\n',
      '.changeset/brave-cats.md': changeset("'@callis/core': minor"),
      '.changeset/AGENTS.md': '# Agents\n',
      '.changeset/pre/old-dogs.md': changeset("'@callis/core': patch"),
    });
    expect(listChangesetFiles(root)).toEqual([
      '.changeset/brave-cats.md',
      '.changeset/pre/old-dogs.md',
    ]);
  });

  it('lists the changesets without a .changeset/pre/ directory', () => {
    const root = repository({ '.changeset/brave-cats.md': changeset("'@callis/core': minor") });
    expect(listChangesetFiles(root)).toEqual(['.changeset/brave-cats.md']);
  });

  it('reads the versions of every package in the workspace globs', () => {
    const root = repository({
      'pnpm-workspace.yaml': [
        'packages:',
        '  - packages/*',
        '# a comment does not end the list',
        "  - 'tools/cli' # one directory",
        '',
        'saveExact: true',
      ].join('\n'),
      'packages/core/package.json': JSON.stringify({ name: '@callis/core', version: '0.2.0' }),
      'packages/unversioned/package.json': JSON.stringify({ name: '@callis/unversioned' }),
      'packages/not-a-package/notes.md': '# Not a package\n',
      'tools/cli/package.json': JSON.stringify({ name: '@callis/cli', version: '1.2.0' }),
      'tools/other/package.json': JSON.stringify({ name: '@callis/other', version: '0.0.0' }),
    });
    expect(readWorkspaceVersions(root)).toEqual(
      new Map([
        ['@callis/core', '0.2.0'],
        ['@callis/unversioned', undefined],
        ['@callis/cli', '1.2.0'],
      ]),
    );
  });

  it.each([
    ['a flow list', 'packages: [packages/*]\n'],
    ['no packages key', 'saveExact: true\n'],
  ])('throws on a workspace file without readable packages: %s', (_, yaml) => {
    const root = repository({ 'pnpm-workspace.yaml': yaml });
    expect(() => readWorkspaceVersions(root)).toThrow('pnpm-workspace.yaml');
  });

  it.each(["  - '!packages/old'", '  - packages/**', '  - packages/*/sub/*'])(
    'throws on a glob it does not support: %s',
    (entry) => {
      const root = repository({ 'pnpm-workspace.yaml': `packages:\n${entry}\n` });
      expect(() => readWorkspaceVersions(root)).toThrow('pnpm-workspace.yaml');
    },
  );

  it('throws on a packages entry it cannot read', () => {
    expect(() => parseWorkspaceGlobs('packages:\n  key: value\n')).toThrow('pnpm-workspace.yaml');
  });

  it('reads every package of this repository', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const workspace = readWorkspaceVersions(root);
    for (const name of [
      '@callis/core',
      '@callis/ucum',
      '@callis/fhir-r4',
      '@callis/fhir-r5',
      '@callis/fhir-r6',
      '@callis/conformance',
      '@callis/model-gen',
      '@callis/site',
    ]) {
      expect(workspace.get(name), name).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});
