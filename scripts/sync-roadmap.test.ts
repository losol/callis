import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadRoadmap } from './roadmap.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const milestone = { number: 7, title: 'Chosen release', state: 'open' };
const issue = {
  number: 11,
  id: 111,
  node_id: 'issue-11',
  title: 'T0001: Lexer',
  state: 'open',
  labels: [{ name: 'task' }, { name: 'wave-1' }],
  milestone: null,
};

interface Fixture {
  readonly milestonePages?: readonly (readonly object[])[];
  readonly issues?: readonly object[];
  readonly currentIssue?: object;
  readonly currentMilestone?: object;
  readonly labels?: readonly object[];
  readonly blockers?: Readonly<Record<string, readonly object[]>>;
}

interface Call {
  readonly args: readonly string[];
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
}

/** Executes the real CLI with a fail-closed, local-only replacement for every `gh` call. */
function run(args: readonly string[], fixture: Fixture = {}) {
  const temporary = mkdtempSync(join(tmpdir(), 'callis-sync-test-'));
  const callsFile = join(temporary, 'calls.jsonl');
  const dataFile = join(temporary, 'fixture.json');
  writeFileSync(
    dataFile,
    JSON.stringify({ milestonePages: [[milestone]], issues: [issue], ...fixture }),
  );
  writeFileSync(
    join(temporary, 'gh'),
    `#!${process.execPath}
import {readFileSync, appendFileSync} from 'node:fs';
const data = JSON.parse(readFileSync(${JSON.stringify(dataFile)}, 'utf8'));
const args = process.argv.slice(2);
const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
const path = args.find(arg => arg.startsWith('repos/losol/callis/'));
const input = readFileSync(0, 'utf8');
const body = input === '' ? undefined : JSON.parse(input);
appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({args, method, path, body}) + String.fromCharCode(10));
let result;
if (method === 'GET' && path === 'repos/losol/callis/milestones?state=all&per_page=100') result = data.milestonePages;
else if (method === 'GET' && path === 'repos/losol/callis/issues?state=all&labels=task&per_page=100') result = [data.issues];
else if (method === 'GET' && path === 'repos/losol/callis/labels?per_page=100') result = [data.labels ?? []];
else if (method === 'GET' && path.endsWith('/dependencies/blocked_by?per_page=100')) result = [data.blockers?.[path.split('/')[4]] ?? []];
else if (method === 'GET' && path.startsWith('repos/losol/callis/milestones/')) result = data.currentMilestone ?? data.milestonePages.flat().find(value => value.number === Number(path.split('/').at(-1)));
else if (method === 'GET' && path.startsWith('repos/losol/callis/issues/')) result = data.currentIssue ?? data.issues.find(value => value.number === Number(path.split('/').at(-1)));
else if (method === 'PATCH' && path.startsWith('repos/losol/callis/issues/')) result = {...data.issues.find(value => value.number === Number(path.split('/').at(-1))), ...body};
else throw new Error('Unexpected mocked gh request: ' + JSON.stringify({args, body}));
console.log(JSON.stringify(result));
`,
    { mode: 0o755 },
  );
  try {
    const result = spawnSync(process.execPath, [join(root, 'scripts/sync-roadmap.ts'), ...args], {
      cwd: root,
      env: { ...process.env, PATH: `${temporary}:${process.env.PATH}`, GH_TOKEN: 'test-only' },
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
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

const selection = ['--release', milestone.title, '--task', 'T0001'];
const writes = (calls: readonly Call[]): readonly Call[] =>
  calls.filter((call) => call.method !== 'GET');

// Release membership is explicit and independent of roadmap waves or worker-owned status.
describe('roadmap milestone CLI', () => {
  it('plans only the chosen milestone by default and reads every milestone page', () => {
    const result = run(selection, { milestonePages: [[], [milestone]] });
    expect(result.status).toBe(0);
    expect(result.output).toContain('(dry run) ~ #11 T0001 milestone: (none) → "Chosen release"');
    expect(writes(result.calls)).toEqual([]);
    expect(result.calls).toHaveLength(2);
    expect(result.calls[0]?.args).toEqual([
      'api',
      '--paginate',
      '--slurp',
      'repos/losol/callis/milestones?state=all&per_page=100',
    ]);
    expect(result.calls.every((call) => !call.args.includes('graphql'))).toBe(true);
  });

  it('applies just one milestone field to an explicitly chosen unassigned task', () => {
    const result = run([...selection, '--task', 'T0001', '--apply']);
    expect(result.status).toBe(0);
    expect(writes(result.calls)).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        path: 'repos/losol/callis/issues/11',
        body: { milestone: 7 },
      }),
    ]);
    const again = run([...selection, '--apply'], {
      issues: [{ ...issue, milestone }],
    });
    expect(again.status).toBe(0);
    expect(again.output).toContain('already assigned');
    expect(writes(again.calls)).toEqual([]);
  });

  it.each([
    [[], 'found 0'],
    [[{ ...milestone, state: 'closed' }], 'is closed'],
    [[milestone, { ...milestone, number: 8 }], 'found 2'],
  ])('rejects an unknown, completed or ambiguous release before any write (%j)', (values, text) => {
    const result = run([...selection, '--apply'], { milestonePages: [values] });
    expect(result.status).toBe(1);
    expect(result.output).toContain(text);
    expect(writes(result.calls)).toEqual([]);
  });

  it.each([
    [['--release', milestone.title], 'at least one --task'],
    [['--task', 'T0001'], 'Use --release'],
    [['--release', ' ', '--task', 'T0001'], 'Use --release'],
    [['--release', milestone.title, '--task', 'T9999'], 'Unknown roadmap tasks'],
  ])(
    'requires an explicit valid release/task selection before contacting GitHub (%j)',
    (args, text) => {
      const result = run([...args, '--apply']);
      expect(result.status).toBe(1);
      expect(result.output).toContain(text);
      expect(result.calls).toEqual([]);
    },
  );

  it.each([
    [[], 'no existing task issue'],
    [[{ ...issue, state: 'closed' }], 'closed issue'],
    [
      [{ ...issue, milestone: { number: 22, title: 'Manual choice', state: 'open' } }],
      'preserve existing',
    ],
  ])('preserves missing, delivered or manually assigned issues (%j)', (issues, text) => {
    const result = run([...selection, '--apply'], { issues });
    expect(result.status).toBe(0);
    expect(result.output).toContain(text);
    expect(writes(result.calls)).toEqual([]);
  });

  it.each([
    { currentIssue: { ...issue, state: 'closed' } },
    { currentIssue: { ...issue, title: 'T0002: Another task' } },
    { currentIssue: { ...issue, milestone: { ...milestone, number: 22 } } },
    { currentMilestone: { ...milestone, state: 'closed' } },
    { currentMilestone: { ...milestone, title: 'Renamed choice' } },
  ])('aborts if the issue or release changes between planning and applying (%j)', (fixture) => {
    const result = run([...selection, '--apply'], fixture);
    expect(result.status).toBe(1);
    expect(result.output).toContain('changed after planning');
    expect(writes(result.calls)).toEqual([]);
  });

  it('leaves manual milestones intact during normal apply with no release input', () => {
    const { roadmap } = loadRoadmap(root);
    const issues = roadmap.tasks.map((task, index) => ({
      ...issue,
      number: index + 1,
      id: index + 100,
      title: `${task.id}: ${task.title}`,
      state: 'closed',
      labels: [{ name: 'task' }, { name: `wave-${task.wave}` }],
      milestone: { number: 22, title: 'Manual choice', state: 'closed' },
    }));
    const blockers = Object.fromEntries(
      roadmap.tasks.map((task, index) => [
        index + 1,
        task.dependsOn.map((id) => {
          const blocker = issues[roadmap.tasks.findIndex((item) => item.id === id)];
          if (blocker === undefined) throw new Error(`Fixture has no task ${id}`);
          return blocker;
        }),
      ]),
    );
    const result = run(['--apply', '--skip-project'], {
      issues,
      blockers,
      labels: [...new Set(roadmap.tasks.map((task) => `wave-${task.wave}`))].map((name) => ({
        name,
      })),
    });
    expect(result.status).toBe(0);
    expect(result.output).toContain('GitHub already matches the roadmap');
    expect(writes(result.calls)).toEqual([]);
    expect(result.calls.every((call) => !call.path.includes('/milestones'))).toBe(true);
  });
});
