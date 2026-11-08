import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  type Call,
  type FakeGhResult,
  type Fixture,
  fakeGh,
  type GraphqlReply,
} from './fake-gh.ts';
import {
  DELIVERED_BEFORE_AREAS,
  loadRoadmap,
  PROJECT_FIELDS,
  projectFieldValues,
  type RoadmapTask,
  TEXT_FIELDS,
  taskAreaLabels,
} from './roadmap.ts';

/**
 * Most tests here run the script in this process. A test that started the command would pay for a
 * Node process for the script and another for every `gh` call (the full roadmap makes about fifty),
 * which takes seconds on an idle machine and longer than any sensible timeout on a busy one. The
 * script calls `gh` only through `execFileSync`, so that is the one thing replaced: its own code
 * still runs, including how it builds the `gh` arguments and reads a failed call.
 */
const gh = vi.hoisted(() => ({
  /** Answers one `gh` call; unset outside `run()`, so nothing can reach a real `gh`. */
  answer: undefined as
    | ((file: string, args: readonly string[], input: string) => string)
    | undefined,
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFileSync: (file: string, args: readonly string[], options?: { readonly input?: string }) => {
    if (gh.answer === undefined) {
      throw new Error(`execFileSync(${file}) ran outside run(): tests never start a real process`);
    }
    return gh.answer(file, args, options?.input ?? '');
  },
}));

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

/** The fixture with the defaults that most tests share, copied the way a file round trip would. */
function withDefaults(fixture: Fixture): Fixture {
  return JSON.parse(JSON.stringify({ milestonePages: [[milestone]], issues: [issue], ...fixture }));
}

/** A failed `gh` call as `execFileSync` reports it: an error that carries the output and status. */
function commandFailed(file: string, args: readonly string[], result: FakeGhResult): Error {
  return Object.assign(
    new Error(`Command failed: ${[file, ...args].join(' ')}\n${result.stderr}`),
    { status: result.status, stdout: result.stdout, stderr: result.stderr },
  );
}

/** Stops the script where the real `process.exit` would. */
class ProcessExit extends Error {
  readonly code: number;

  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

/**
 * Runs the real script in this process with the arguments `args` and the fake `gh` for every GitHub
 * call. The script runs when it is imported and keeps its state in module variables, so every run
 * imports a fresh copy. Its output is collected instead of printed, and `process.exit` ends the run
 * instead of the test process.
 */
async function run(args: readonly string[], fixture: Fixture = {}) {
  const data = withDefaults(fixture);
  const calls: Call[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  gh.answer = (file, ghArgs, input) => {
    if (file !== 'gh') {
      throw new Error(`Unexpected command: ${file}`);
    }
    const result = fakeGh(data, ghArgs, input);
    calls.push(result.call);
    if (result.status !== 0) {
      throw commandFailed(file, ghArgs, result);
    }
    return result.stdout;
  };
  const spies = [
    vi.spyOn(console, 'log').mockImplementation((...values) => {
      stdout.push(values.join(' '));
    }),
    vi.spyOn(console, 'error').mockImplementation((...values) => {
      stderr.push(values.join(' '));
    }),
    // The script pauses after every write to stay below GitHub's rate limits. That is a sleep, not
    // behaviour under test.
    vi.spyOn(Atomics, 'wait').mockReturnValue('ok'),
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ProcessExit(Number(code ?? 0));
    }),
  ];
  const argv = process.argv;
  process.argv = [argv[0] ?? 'node', 'scripts/sync-roadmap.ts', ...args];
  vi.resetModules();
  let status = 0;
  try {
    await import('./sync-roadmap.ts');
  } catch (error) {
    if (!(error instanceof ProcessExit)) {
      throw error;
    }
    status = error.code;
  } finally {
    process.argv = argv;
    gh.answer = undefined;
    for (const spy of spies) {
      spy.mockRestore();
    }
  }
  return { status, output: [...stdout, ...stderr].join('\n'), calls };
}

/**
 * A run takes well under a second on an idle machine, so this is far above what a busy one needs.
 * A run that never ends is still reported: `spawnSync` kills it at this limit and the test fails
 * with `ETIMEDOUT` and the output so far. The test's own timeout is just above, so that error, not
 * Vitest's generic one, is what a hang shows.
 */
const COMMAND_TIMEOUT_MS = 60_000;
const COMMAND_TEST = { timeout: COMMAND_TIMEOUT_MS + 5_000 };

/**
 * Runs the script as a command: a new Node process, with an executable named `gh` first on `PATH`
 * that answers from the same fake. For the few tests of what an in-process run cannot show.
 */
function runCommand(args: readonly string[], fixture: Fixture = {}) {
  const temporary = mkdtempSync(join(tmpdir(), 'callis-sync-test-'));
  const callsFile = join(temporary, 'calls.jsonl');
  const dataFile = join(temporary, 'fixture.json');
  writeFileSync(dataFile, JSON.stringify(withDefaults(fixture)));
  writeFileSync(
    join(temporary, 'gh'),
    `#!${process.execPath}
import { appendFileSync, readFileSync, writeSync } from 'node:fs';
import { fakeGh } from ${JSON.stringify(pathToFileURL(join(root, 'scripts/fake-gh.ts')).href)};
const data = JSON.parse(readFileSync(${JSON.stringify(dataFile)}, 'utf8'));
const result = fakeGh(data, process.argv.slice(2), readFileSync(0, 'utf8'));
appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(result.call) + String.fromCharCode(10));
writeSync(1, result.stdout);
writeSync(2, result.stderr);
process.exit(result.status);
`,
    { mode: 0o755 },
  );
  try {
    const result = spawnSync(process.execPath, [join(root, 'scripts/sync-roadmap.ts'), ...args], {
      cwd: root,
      env: { ...process.env, PATH: `${temporary}:${process.env.PATH}`, GH_TOKEN: 'test-only' },
      encoding: 'utf8',
      timeout: COMMAND_TIMEOUT_MS,
    });
    if (result.error !== undefined) {
      throw result.error;
    }
    let calls: Call[] = [];
    try {
      calls = readFileSync(callsFile, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      stderr: result.stderr,
      calls,
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

const selection = ['--release', milestone.title, '--task', 'T0001'];
const writes = (calls: readonly Call[]): readonly Call[] =>
  calls.filter((call) => call.method !== 'GET');

// Release membership is explicit and independent of roadmap waves or worker-owned status.
describe('roadmap milestone CLI', () => {
  it('plans only the chosen milestone by default and reads every milestone page', async () => {
    const result = await run(selection, { milestonePages: [[], [milestone]] });
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

  it('applies just one milestone field to an explicitly chosen unassigned task', async () => {
    const result = await run([...selection, '--task', 'T0001', '--apply']);
    expect(result.status).toBe(0);
    expect(writes(result.calls)).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        path: 'repos/losol/callis/issues/11',
        body: { milestone: 7 },
      }),
    ]);
    const again = await run([...selection, '--apply'], {
      issues: [{ ...issue, milestone }],
    });
    expect(again.status).toBe(0);
    expect(again.output).toContain('already assigned');
    expect(writes(again.calls)).toEqual([]);
  });

  it('fails when GitHub accepts the PATCH but silently drops the milestone without push access', async () => {
    const result = await run([...selection, '--apply'], { patchResponse: issue });
    expect(result.status).toBe(1);
    expect(result.output).toContain('GitHub did not assign milestone');
    expect(result.output).toContain('Verify repository push access');
    expect(result.output).not.toContain('✓ 1 changes');
    expect(writes(result.calls)).toEqual([
      expect.objectContaining({ method: 'PATCH', body: { milestone: 7 } }),
    ]);
  });

  it.each([
    [[], 'found 0'],
    [[{ ...milestone, state: 'closed' }], 'is closed'],
    [[milestone, { ...milestone, number: 8 }], 'found 2'],
  ])(
    'rejects an unknown, completed or ambiguous release before any write (%j)',
    async (values, text) => {
      const result = await run([...selection, '--apply'], { milestonePages: [values] });
      expect(result.status).toBe(1);
      expect(result.output).toContain(text);
      expect(writes(result.calls)).toEqual([]);
    },
  );

  it.each([
    [['--release', milestone.title], 'at least one --task'],
    [['--task', 'T0001'], 'Use --release'],
    [['--release', ' ', '--task', 'T0001'], 'Use --release'],
    [['--release', milestone.title, '--task', 'T9999'], 'Unknown roadmap tasks'],
  ])(
    'requires an explicit valid release/task selection before contacting GitHub (%j)',
    async (args, text) => {
      const result = await run([...args, '--apply']);
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
  ])('preserves missing, delivered or manually assigned issues (%j)', async (issues, text) => {
    const result = await run([...selection, '--apply'], { issues });
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
  ])(
    'aborts if the issue or release changes between planning and applying (%j)',
    async (fixture) => {
      const result = await run([...selection, '--apply'], fixture);
      expect(result.status).toBe(1);
      expect(result.output).toContain('changed after planning');
      expect(writes(result.calls)).toEqual([]);
    },
  );

  it('leaves manual milestones intact during normal apply with no release input', async () => {
    const result = await run(['--apply', '--skip-project'], syncedFixture());
    expect(result.status).toBe(0);
    expect(result.output).toContain('GitHub already matches the roadmap');
    expect(writes(result.calls)).toEqual([]);
    expect(result.calls.every((call) => !call.path.includes('/milestones'))).toBe(true);
  });
});

/**
 * A GitHub that matches the roadmap of this repository: one closed issue per task with its labels
 * and "blocked by" links, every wave and area label, and a manual milestone on each issue. `edit`
 * changes the labels of single tasks.
 */
function syncedFixture(
  edit: (task: RoadmapTask, labels: string[]) => string[] = (_task, labels) => labels,
): Fixture {
  const { roadmap } = loadRoadmap(root);
  const issues = roadmap.tasks.map((task, index) => ({
    ...issue,
    number: index + 1,
    id: index + 100,
    title: `${task.id}: ${task.title}`,
    state: 'closed',
    labels: edit(task, ['task', `wave-${task.wave}`, ...taskAreaLabels(task)]).map((name) => ({
      name,
    })),
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
  const labels = new Set([
    ...roadmap.tasks.map((task) => `wave-${task.wave}`),
    ...roadmap.tasks.flatMap(taskAreaLabels),
  ]);
  return { issues, blockers, labels: [...labels].map((name) => ({ name })) };
}

// CONTRIBUTING.md, "Roadmap sync": the task file's Area line is the source of the area labels.
describe('roadmap area labels', () => {
  const { roadmap } = loadRoadmap(root);
  const withAreas = roadmap.tasks.find((task) => (task.areas?.length ?? 0) > 0);
  const delivered = roadmap.tasks.find((task) => DELIVERED_BEFORE_AREAS.has(task.id));
  if (withAreas === undefined || delivered === undefined) {
    throw new Error('The roadmap needs a task with areas and one delivered before areas.');
  }
  const number = roadmap.tasks.indexOf(withAreas) + 1;
  const stale = withAreas.areas?.includes('docs') ? 'area:site' : 'area:docs';

  it('replaces stale area labels and leaves those of a task without an Area line', async () => {
    const fixture = syncedFixture((task, labels) => {
      if (task.id === withAreas.id) return ['task', `wave-${task.wave}`, stale, 'help wanted'];
      if (task.id === delivered.id) return [...labels, 'area:docs'];
      return labels;
    });
    const dryRun = await run(['--skip-project'], fixture);
    expect(dryRun.status).toBe(0);
    expect(writes(dryRun.calls)).toEqual([]);
    expect(dryRun.output).toContain(`(dry run) ~ #${number} labels`);

    const result = await run(['--apply', '--skip-project'], fixture);
    expect(result.status).toBe(0);
    expect(writes(result.calls)).toEqual([
      {
        args: expect.any(Array),
        method: 'PATCH',
        path: `repos/losol/callis/issues/${number}`,
        body: {
          labels: ['task', `wave-${withAreas.wave}`, ...taskAreaLabels(withAreas), 'help wanted'],
        },
      },
    ]);
  });

  it('creates a missing area label with its color and description', async () => {
    const [label] = taskAreaLabels(withAreas);
    const fixture = syncedFixture();
    const result = await run(['--apply', '--skip-project'], {
      ...fixture,
      labels: (fixture.labels ?? []).filter((value) => 'name' in value && value.name !== label),
    });
    expect(result.status).toBe(0);
    expect(writes(result.calls)).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: 'repos/losol/callis/labels',
        body: { name: label, color: expect.any(String), description: expect.any(String) },
      }),
    ]);
  });
});

// https://github.com/losol/callis/issues/158: a fine-grained token that can read only the Callis
// roadmap project must still sync it, and a lookup that fails for lack of access must not create a
// second project. The replies copy what `gh api graphql` does: any GraphQL error, partial ones
// included, makes it exit 1, but it still prints the whole response.
describe('roadmap project lookup', () => {
  const project = {
    id: 'PVT_roadmap',
    title: 'Callis roadmap',
    url: 'https://github.com/orgs/losol/projects/11',
  };
  const repositoryList = 'query: $title';
  const organizationList = 'organization(login: $login) { projectsV2';
  const denial = 'Resource not accessible by personal access token';

  const list = (match: string, root: string, nodes: readonly unknown[]): GraphqlReply => ({
    match,
    stdout: { data: { [root]: { projectsV2: { nodes } } } },
  });
  const forbidden = (...path: (string | number)[]) => ({
    type: 'FORBIDDEN',
    path,
    locations: [{ line: 1, column: 1 }],
    message: denial,
  });
  /** A reply with `errors`: `gh` prints the response and exits 1. */
  const failed = (match: string, data: unknown, errors: readonly { message: string }[]) => ({
    match,
    stdout: { data, errors },
    stderr: `gh: ${errors[0]?.message}\n`,
    status: 1,
  });
  /** The project board of a project that has no fields and no items yet. */
  const emptyBoard: readonly GraphqlReply[] = [
    { match: 'fields(first: 50)', stdout: { data: { node: { fields: { nodes: [] } } } } },
    {
      match: 'items(first: 100',
      stdout: {
        data: { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } },
      },
    },
  ];
  /** A dry run in which GitHub has no task issues, so only the project is of interest. */
  const dryRun = (...replies: readonly GraphqlReply[]) =>
    run([], { issues: [], labels: [], graphql: [...replies, ...emptyBoard] });
  const queries = (calls: readonly Call[]): string[] =>
    calls.flatMap((call) =>
      call.path === 'graphql' &&
      typeof call.body === 'object' &&
      call.body !== null &&
      'query' in call.body &&
      typeof call.body.query === 'string'
        ? [call.body.query]
        : [],
    );
  const readsOrganization = (calls: readonly Call[]) =>
    queries(calls).some((query) => query.includes(organizationList));

  it('finds the project through the repository without reading the organization projects', async () => {
    const result = await dryRun(list(repositoryList, 'repository', [project]));
    expect(result.status).toBe(0);
    expect(result.output).toContain(`· ${project.url}`);
    expect(result.output).not.toContain('+ project "');
    expect(readsOrganization(result.calls)).toBe(false);
    expect(writes(result.calls)).toEqual([]);
    const lookup = result.calls.find((call) => queries([call])[0]?.includes(repositoryList));
    expect(lookup?.body).toEqual({
      query: expect.any(String),
      variables: { owner: 'losol', name: 'callis', title: 'Callis roadmap' },
    });
  });

  it('falls back to the organization projects when the repository list lacks an exact title match', async () => {
    const similar = { ...project, id: 'PVT_other', title: 'Callis roadmap archive' };
    const result = await dryRun(
      list(repositoryList, 'repository', [similar]),
      list(organizationList, 'organization', [similar, project]),
    );
    expect(result.status).toBe(0);
    expect(result.output).toContain(`· ${project.url}`);
    expect(result.output).not.toContain('+ project "');
    expect(readsOrganization(result.calls)).toBe(true);
  });

  it.each([
    ['first', [project, null, null], [1, 2]],
    ['in the middle', [null, project, null], [0, 2]],
    ['last', [null, null, project], [0, 1]],
  ])(
    'uses the project when GitHub hides other organization projects (%s in the list)',
    async (_position, nodes, hidden) => {
      const result = await dryRun(
        list(repositoryList, 'repository', []),
        failed(
          organizationList,
          { organization: { projectsV2: { nodes } } },
          hidden.map((index) => forbidden('organization', 'projectsV2', 'nodes', index)),
        ),
      );
      expect(result.status).toBe(0);
      expect(result.output).toContain(`· ${project.url}`);
      expect(result.output).not.toContain('+ project "');
    },
  );

  it('uses the project when GitHub hides other projects linked to the repository', async () => {
    const result = await dryRun(
      failed(repositoryList, { repository: { projectsV2: { nodes: [null, project] } } }, [
        forbidden('repository', 'projectsV2', 'nodes', 0),
      ]),
    );
    expect(result.status).toBe(0);
    expect(result.output).toContain(`· ${project.url}`);
    expect(readsOrganization(result.calls)).toBe(false);
  });

  it('falls back to the organization projects when the repository lookup is denied outright', async () => {
    const result = await dryRun(
      failed(repositoryList, { repository: { projectsV2: null } }, [
        forbidden('repository', 'projectsV2'),
      ]),
      list(organizationList, 'organization', [project]),
    );
    expect(result.status).toBe(0);
    expect(result.output).toContain(`· ${project.url}`);
    expect(result.output).not.toContain('+ project "');
  });

  it('plans to create the project only when both lists were read and lack it', async () => {
    const result = await dryRun(
      list(repositoryList, 'repository', []),
      list(organizationList, 'organization', [{ ...project, title: 'Eventuras backlog' }]),
    );
    expect(result.status).toBe(0);
    expect(result.output).toContain(
      '(dry run) + project "Callis roadmap" in losol, linked to losol/callis',
    );
    expect(result.output).toContain('The project does not exist yet');
    expect(writes(result.calls)).toEqual([]);
  });

  it('does not plan a second project when GitHub hid projects and the project is not among those it showed', async () => {
    const result = await dryRun(
      list(repositoryList, 'repository', []),
      failed(organizationList, { organization: { projectsV2: { nodes: [null, null] } } }, [
        forbidden('organization', 'projectsV2', 'nodes', 0),
        forbidden('organization', 'projectsV2', 'nodes', 1),
      ]),
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain('The project "Callis roadmap" was not found');
    expect(result.output).toContain(denial);
    expect(result.output).toContain('not created again');
    expect(result.output).not.toContain('+ project "');
    expect(result.output).not.toContain('does not exist yet');
  });

  it('names the missing permissions instead of only the project scope', async () => {
    const result = await dryRun(
      failed(repositoryList, { repository: { projectsV2: null } }, [
        forbidden('repository', 'projectsV2'),
      ]),
      failed(organizationList, { organization: { projectsV2: null } }, [
        forbidden('organization', 'projectsV2'),
      ]),
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain('Issues: read and write');
    expect(result.output).toContain('Projects: read and write');
    expect(result.output).toContain('the `project` scope');
    expect(result.output).toContain('--skip-project');
  });

  it('fails on an error that is not an access error, without trying the organization projects', async () => {
    const message = "Could not resolve to a Repository with the name 'losol/callis'.";
    const result = await dryRun(
      failed(repositoryList, { repository: null }, [
        { type: 'NOT_FOUND', path: ['repository'], message } as { message: string },
      ]),
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain(message);
    expect(readsOrganization(result.calls)).toBe(false);
    expect(result.output).not.toContain('+ project "');
  });

  it('fails on an access error outside the list entries even when the project was found', async () => {
    const result = await dryRun(
      failed(repositoryList, { repository: { projectsV2: { nodes: [project] } } }, [
        forbidden('repository', 'projectsV2', 'totalCount'),
      ]),
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain(`${denial} at repository.projectsV2.totalCount`);
    expect(result.output).not.toContain(`· ${project.url}`);
  });

  it('fails on a failure without a GraphQL error list, as for bad credentials', async () => {
    const result = await dryRun({
      match: repositoryList,
      stdout: { message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest' },
      stderr: 'gh: Bad credentials (HTTP 401)\n',
      status: 1,
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('Bad credentials');
    expect(queries(result.calls)).toHaveLength(1);
    expect(result.output).not.toContain('+ project "');
  });

  // Applying is where a wrong lookup does harm, so these run the complete sync against a GitHub
  // that matches the roadmap, with the project board as the only thing in question.
  describe('when applying', () => {
    const empty = (match: string, root: string): GraphqlReply => ({
      match,
      stdout: { data: { [root]: { projectsV2: { nodes: [] } } } },
    });

    /** The fields and items of a board that matches the roadmap, one item per synced issue. */
    function completeBoard(): readonly GraphqlReply[] {
      const { roadmap } = loadRoadmap(root);
      const textFields: ReadonlySet<string> = TEXT_FIELDS;
      const fields = PROJECT_FIELDS.map((name) => ({
        id: `field-${name}`,
        name,
        ...(textFields.has(name)
          ? {}
          : {
              options: [
                ...new Set(roadmap.tasks.map((task) => projectFieldValues(task)[name])),
              ].map((value) => ({ id: `${name}-${value}`, name: value })),
            }),
      }));
      const nodes = roadmap.tasks.map((task, index) => ({
        id: `item-${index + 1}`,
        content: { number: index + 1, repository: { nameWithOwner: 'losol/callis' } },
        fieldValues: {
          nodes: Object.entries({ ...projectFieldValues(task), Status: 'Done' }).map(
            ([name, value]) => ({
              ...(textFields.has(name) ? { text: value } : { name: value }),
              field: { name },
            }),
          ),
        },
      }));
      return [
        { match: 'fields(first: 50)', stdout: { data: { node: { fields: { nodes: fields } } } } },
        {
          match: 'items(first: 100',
          stdout: {
            data: { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } },
          },
        },
      ];
    }
    /** The names of the GraphQL mutations that were sent, such as `createProjectV2`. */
    const mutations = (calls: readonly Call[]): string[] =>
      queries(writes(calls)).map(
        (query) => /^\s*mutation[^{]*\{\s*(\w+)/.exec(query)?.[1] ?? query,
      );
    const creation: readonly GraphqlReply[] = [
      {
        match: 'organization(login: $login) { id }',
        stdout: { data: { organization: { id: 'ORG' }, repository: { id: 'REPO' } } },
      },
    ];

    it('creates the project when it exists in neither list, and then syncs it', async () => {
      const result = await run(['--apply'], {
        ...syncedFixture(),
        graphql: [
          empty(repositoryList, 'repository'),
          empty(organizationList, 'organization'),
          ...creation,
          {
            match: 'createProjectV2(',
            stdout: { data: { createProjectV2: { projectV2: project } } },
          },
          {
            match: 'updateProjectV2(',
            stdout: { data: { updateProjectV2: { projectV2: { id: project.id } } } },
          },
          ...completeBoard(),
        ],
      });
      expect(result.status).toBe(0);
      expect(mutations(result.calls)).toEqual(['createProjectV2', 'updateProjectV2']);
      expect(result.output).toContain(`✓ 1 changes · ${project.url}`);
    });

    it('writes nothing when access to the projects was denied and the project was not found', async () => {
      const result = await run(['--apply'], {
        ...syncedFixture(),
        graphql: [
          {
            match: repositoryList,
            stdout: {
              data: { repository: { projectsV2: null } },
              errors: [forbidden('repository', 'projectsV2')],
            },
            stderr: `gh: ${denial}\n`,
            status: 1,
          },
          {
            match: organizationList,
            stdout: {
              data: { organization: { projectsV2: { nodes: [null, null] } } },
              errors: [
                forbidden('organization', 'projectsV2', 'nodes', 0),
                forbidden('organization', 'projectsV2', 'nodes', 1),
              ],
            },
            stderr: `gh: ${denial}\n`,
            status: 1,
          },
          ...creation,
          {
            match: 'createProjectV2(',
            stdout: { data: { createProjectV2: { projectV2: project } } },
          },
        ],
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain('not created again');
      expect(writes(result.calls)).toEqual([]);
    });

    it('still fails when a mutation answers with data and errors', async () => {
      const result = await run(['--apply'], {
        ...syncedFixture(),
        graphql: [
          empty(repositoryList, 'repository'),
          empty(organizationList, 'organization'),
          ...creation,
          {
            match: 'createProjectV2(',
            stdout: {
              data: { createProjectV2: { projectV2: project } },
              errors: [forbidden('createProjectV2', 'projectV2', 'url')],
            },
            stderr: `gh: ${denial}\n`,
            status: 1,
          },
          {
            match: 'updateProjectV2(',
            stdout: { data: { updateProjectV2: { projectV2: { id: project.id } } } },
          },
          ...completeBoard(),
        ],
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain(denial);
      expect(mutations(result.calls)).toEqual(['createProjectV2']);
    });
  });
});

// The tests above run the script in this process. These start it as a command, for what an
// in-process run cannot show: the real argument vector, `gh` found on PATH, a request body piped
// through standard input, standard error, and the exit status.
describe('roadmap sync as a command', () => {
  it('plans a release without writing, through the gh on PATH', COMMAND_TEST, () => {
    const result = runCommand(selection);
    expect(result.status).toBe(0);
    expect(result.output).toContain('(dry run) ~ #11 T0001 milestone: (none) → "Chosen release"');
    expect(result.calls.map((call) => call.args)).toEqual([
      ['api', '--paginate', '--slurp', 'repos/losol/callis/milestones?state=all&per_page=100'],
      [
        'api',
        '--paginate',
        '--slurp',
        'repos/losol/callis/issues?state=all&labels=task&per_page=100',
      ],
    ]);
  });

  it('sends a request body to gh on standard input', COMMAND_TEST, () => {
    const result = runCommand([...selection, '--apply']);
    expect(result.status).toBe(0);
    expect(writes(result.calls)).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        path: 'repos/losol/callis/issues/11',
        body: { milestone: 7 },
      }),
    ]);
    expect(writes(result.calls)[0]?.args.slice(-2)).toEqual(['--input', '-']);
  });

  it(
    'exits with status 1 and explains on standard error when the release is unknown',
    COMMAND_TEST,
    () => {
      const result = runCommand([...selection, '--apply'], { milestonePages: [[]] });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('found 0');
      expect(writes(result.calls)).toEqual([]);
    },
  );
});
