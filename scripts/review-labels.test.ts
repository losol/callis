import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { REVIEW_LABELS } from './review-areas.ts';

// The workflow and the command come from CONTRIBUTING.md, "Review areas and model tiers".

const script = fileURLToPath(new URL('review-labels.ts', import.meta.url));
const temporaries: string[] = [];

afterEach(() => {
  for (const path of temporaries.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function temporary(): string {
  const path = mkdtempSync(join(tmpdir(), 'callis-review-labels-'));
  temporaries.push(path);
  return path;
}

interface Fixture {
  readonly pull?: object;
  readonly files?: readonly object[];
  readonly labels?: readonly object[];
}

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
}

/** Runs the CLI in `cwd` with a fail-closed, local-only replacement for every `gh` call. */
function run(args: readonly string[], fixture: Fixture = {}, cwd = temporary()) {
  const bin = temporary();
  const callsFile = join(bin, 'calls.jsonl');
  const dataFile = join(bin, 'fixture.json');
  writeFileSync(dataFile, JSON.stringify(fixture));
  writeFileSync(
    join(bin, 'gh'),
    `#!${process.execPath}
import {readFileSync, appendFileSync} from 'node:fs';
const data = JSON.parse(readFileSync(${JSON.stringify(dataFile)}, 'utf8'));
const args = process.argv.slice(2);
const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
const path = args.find(arg => arg.startsWith('repos/'));
const input = readFileSync(0, 'utf8');
const body = input === '' ? undefined : JSON.parse(input);
appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({method, path, body}) + String.fromCharCode(10));
let result;
if (method === 'GET' && path === 'repos/losol/callis/pulls/7') result = data.pull;
else if (method === 'GET' && path === 'repos/losol/callis/pulls/7/files?per_page=100') result = [data.files];
else if (method === 'GET' && path === 'repos/losol/callis/labels?per_page=100') result = [data.labels];
else if (method === 'POST' && path === 'repos/losol/callis/issues/7/labels') result = [];
else if (method === 'POST' && path === 'repos/losol/callis/labels') result = body;
else throw new Error('Unexpected mocked gh request: ' + JSON.stringify({args, body}));
console.log(JSON.stringify(result));
`,
    { mode: 0o755 },
  );
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GH_TOKEN: 'test-only',
      GITHUB_REPOSITORY: 'losol/callis',
    },
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.error !== undefined) throw result.error;
  let calls: Call[] = [];
  try {
    calls = readFileSync(callsFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  return { status: result.status, output: result.stdout + result.stderr, calls };
}

const writes = (calls: readonly Call[]) => calls.filter((call) => call.method !== 'GET');

function file(path: string, patch = '@@ -1 +1 @@\n-a\n+b', status = 'modified') {
  return { filename: path, status, additions: 1, deletions: 1, patch };
}

describe('labelling a pull request', () => {
  const pull = { changed_files: 2, labels: [{ name: 'area:docs' }, { name: 'manual' }] };
  const files = [file('docs/guide.md'), file('packages/core/src/functions/existence.ts')];

  it('shows the labels it would add without writing', () => {
    const result = run(['--pr', '7'], { pull, files });
    expect(result.status).toBe(0);
    expect(result.output).toContain('Areas: functions, docs');
    expect(result.output).toContain('Tier: standard');
    expect(result.output).toContain('(dry run) + #7 labels area:functions');
    expect(writes(result.calls)).toEqual([]);
  });

  it('adds only the missing labels and never removes one', () => {
    const result = run(['--pr', '7', '--apply'], { pull, files });
    expect(result.status).toBe(0);
    expect(writes(result.calls)).toEqual([
      {
        method: 'POST',
        path: 'repos/losol/callis/issues/7/labels',
        body: { labels: ['area:functions'] },
      },
    ]);
  });

  // A label set by hand, or kept from an earlier push, keeps the review stricter.
  it('counts a risk:high set by hand in the tier', () => {
    const result = run(['--pr', '7', '--apply'], {
      pull: { changed_files: 1, labels: [{ name: 'risk:high' }] },
      files: [file('packages/core/src/functions/existence.ts')],
    });
    expect(result.status).toBe(0);
    expect(result.output).toContain('Already on the pull request, and counted: risk:high');
    expect(result.output).toContain('Tier: core (raised from standard)\n');
    expect(result.output).toContain('Labels: area:functions, risk:high');
    expect(writes(result.calls)).toEqual([
      expect.objectContaining({ body: { labels: ['area:functions'] } }),
    ]);
  });

  it('counts a stricter area label kept from an earlier push in the tier', () => {
    const result = run(['--pr', '7', '--apply'], {
      pull: { changed_files: 1, labels: [{ name: 'area:core' }, { name: 'risk:high' }] },
      files: [file('docs/guide.md')],
    });
    expect(result.status).toBe(0);
    expect(result.output).toContain('Areas: docs');
    expect(result.output).toContain(
      'Already on the pull request, and counted: area:core, risk:high',
    );
    expect(result.output).toContain('Tier: core, with a second reviewer from the other vendor');
    expect(writes(result.calls)).toEqual([
      expect.objectContaining({ body: { labels: ['area:docs'] } }),
    ]);
  });

  it('raises the risk when GitHub lists fewer files than the pull request changes', () => {
    const result = run(['--pr', '7', '--apply'], {
      pull: { ...pull, changed_files: 3001 },
      files,
    });
    expect(result.status).toBe(0);
    expect(result.output).toContain('GitHub listed 2 of its 3001 changed files');
    expect(writes(result.calls)).toEqual([
      expect.objectContaining({ body: { labels: ['area:functions', 'risk:high'] } }),
    ]);
  });

  it('prints file names as JSON, so a name cannot start a workflow command', () => {
    const result = run(['--pr', '7'], {
      pull: { ...pull, changed_files: 1 },
      files: [file('notes\n::error::injected.txt')],
    });
    expect(result.status).toBe(0);
    expect(result.output).toContain('"notes\\n::error::injected.txt"');
    expect(result.output.split('\n').some((line) => line.startsWith('::'))).toBe(false);
  });

  it.each([['seven'], ['7; rm -rf /']])(
    'rejects the pull request %j before calling GitHub',
    (pr) => {
      const result = run(['--pr', pr, '--apply'], { pull, files });
      expect(result.status).toBe(1);
      expect(result.output).toContain('--pr takes a pull request number');
      expect(result.calls).toEqual([]);
    },
  );
});

describe('setting up the labels', () => {
  const [first, ...others] = REVIEW_LABELS;
  if (first === undefined) throw new Error('No review labels.');

  it('creates only the missing labels, and only with --apply', () => {
    const labels = [{ ...first, color: '000000' }];
    const dryRun = run(['--setup'], { labels });
    expect(dryRun.status).toBe(0);
    expect(dryRun.output).toContain(`= label ${first.name} exists with another color`);
    expect(writes(dryRun.calls)).toEqual([]);

    const result = run(['--setup', '--apply'], { labels });
    expect(result.status).toBe(0);
    expect(writes(result.calls)).toEqual(
      others.map((label) => ({ method: 'POST', path: 'repos/losol/callis/labels', body: label })),
    );
  });

  it('reports when every label exists', () => {
    const result = run(['--setup', '--apply'], { labels: REVIEW_LABELS });
    expect(result.output).toContain('Every review label exists');
    expect(writes(result.calls)).toEqual([]);
  });
});

describe('classifying a local branch', () => {
  function git(cwd: string, ...args: string[]): string {
    return execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
      { cwd, encoding: 'utf8' },
    );
  }

  function write(cwd: string, path: string, content: string): void {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }

  it('reads committed, uncommitted, renamed and untracked changes against the merge base', () => {
    const cwd = temporary();
    git(cwd, 'init', '--quiet');
    write(cwd, 'packages/core/src/index.ts', "export { Decimal } from './values/decimal.ts';\n");
    write(cwd, 'packages/core/src/values/decimal.ts', 'export class Decimal {}\n');
    write(
      cwd,
      'packages/core/src/runtime/a.test.ts',
      "it('a', () => {\n  expect(1).toBe(1);\n});\n",
    );
    write(cwd, 'docs/old name.md', '# Old\n');
    git(cwd, 'add', '.');
    git(cwd, 'commit', '--quiet', '-m', 'base');
    const base = git(cwd, 'rev-parse', 'HEAD').trim();

    git(cwd, 'mv', 'docs/old name.md', 'docs/new name.md');
    git(cwd, 'commit', '--quiet', '-m', 'rename');
    write(cwd, 'packages/core/src/values/decimal.ts', 'export class Decimal { x = 1; }\n');
    write(cwd, 'packages/core/src/runtime/a.test.ts', '// none\n');
    write(cwd, 'notes.txt', 'untracked\n');

    const result = run(['--base', base], {}, cwd);
    expect(result.status).toBe(0);
    expect(result.output).toContain('Areas: core, docs');
    expect(result.output).toContain(
      '"packages/core/src/values/decimal.ts": public API: a module that a package entry point re-exports',
    );
    expect(result.output).toContain(
      '"packages/core/src/runtime/a.test.ts": removes more test cases and assertions (2) than it adds (0)',
    );
    expect(result.output).toContain('"notes.txt": outside every review area');
    expect(result.output).toContain('Tier: core, with a second reviewer from the other vendor');
    expect(result.output).toContain('Labels: area:core, area:docs, risk:high');
    expect(result.calls).toEqual([]);
  });

  it('refuses --apply without a pull request or --setup', () => {
    const result = run(['--apply']);
    expect(result.status).toBe(1);
    expect(result.output).toContain('--apply needs --pr <number> or --setup');
  });
});
