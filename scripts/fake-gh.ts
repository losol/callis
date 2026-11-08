/**
 * A local, fail-closed stand-in for the GitHub CLI, for the tests of `sync-roadmap.ts`. Given the
 * arguments and standard input of one `gh` call, it answers from a fixture and describes the call;
 * a request that the fixture does not cover fails the call, so a test never reaches GitHub or
 * silently accepts a request it did not expect.
 *
 * It is a pure function, so a test can answer `gh` calls in its own process. The tests that run the
 * real command put it behind an executable named `gh`. Keep this file to syntax that Node can strip
 * (no enums), because that executable imports it directly.
 */

/** A fixture entry that carries a `number`, such as a milestone or an issue. */
interface Numbered {
  readonly number: number;
  readonly [key: string]: unknown;
}

/**
 * What the fake answers to a GraphQL request whose query contains `match`: it prints `stdout` and
 * `stderr`, then exits with `status`. Like the real `gh api graphql`, a reply that carries GraphQL
 * `errors` must exit 1 and still print the whole response.
 */
export interface GraphqlReply {
  readonly match: string;
  readonly stdout?: unknown;
  readonly stderr?: string;
  readonly status?: number;
}

export interface Fixture {
  readonly milestonePages?: readonly (readonly Numbered[])[];
  readonly issues?: readonly Numbered[];
  readonly currentIssue?: object;
  readonly currentMilestone?: object;
  readonly patchResponse?: object;
  readonly labels?: readonly object[];
  readonly blockers?: Readonly<Record<string, readonly object[]>>;
  /** Without a matching reply, a GraphQL request fails the call. */
  readonly graphql?: readonly GraphqlReply[];
}

/** One `gh` call as the script made it. */
export interface Call {
  readonly args: readonly string[];
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
}

/** What the call printed and how it ended, like a finished `gh` process. */
export interface FakeGhResult {
  readonly call: Call;
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const API = 'repos/losol/callis/';

/** Answers one `gh` call. `input` is what the script wrote to standard input, empty for no body. */
export function fakeGh(data: Fixture, args: readonly string[], input: string): FakeGhResult {
  const method = args.includes('--method') ? (args[args.indexOf('--method') + 1] ?? 'GET') : 'GET';
  const path = args.find((arg) => arg.startsWith(API));
  const body: unknown = input === '' ? undefined : JSON.parse(input);

  if (args[0] === 'api' && args[1] === 'graphql') {
    const query = typeof body === 'object' && body !== null && 'query' in body ? body.query : '';
    if (typeof query !== 'string') {
      throw new Error('A mocked gh graphql request needs a query string.');
    }
    const call: Call = {
      args,
      method: query.trimStart().startsWith('mutation') ? 'POST' : 'GET',
      path: 'graphql',
      body,
    };
    const reply = (data.graphql ?? []).find((value) => query.includes(value.match));
    if (reply === undefined) {
      return failed(call, `Unexpected mocked gh graphql request: ${query}`);
    }
    return {
      call,
      status: reply.status ?? 0,
      stdout: reply.stdout === undefined ? '' : JSON.stringify(reply.stdout),
      stderr: reply.stderr ?? '',
    };
  }

  const call: Call = { args, method, path: path ?? '', body };
  const result = path === undefined ? undefined : rest(data, method, path, body);
  if (result === undefined) {
    return failed(call, `Unexpected mocked gh request: ${JSON.stringify({ args, body })}`);
  }
  return { call, status: 0, stdout: `${JSON.stringify(result.value)}\n`, stderr: '' };
}

function failed(call: Call, message: string): FakeGhResult {
  return { call, status: 1, stdout: '', stderr: `${message}\n` };
}

/** The REST routes the sync uses; `undefined` for any other request. */
function rest(
  data: Fixture,
  method: string,
  path: string,
  body: unknown,
): { value: unknown } | undefined {
  const milestones = (data.milestonePages ?? []).flat();
  const issues = data.issues ?? [];
  const last = Number(path.split('/').at(-1));
  if (method === 'GET') {
    if (path === `${API}milestones?state=all&per_page=100`) {
      return { value: data.milestonePages };
    }
    if (path === `${API}issues?state=all&labels=task&per_page=100`) {
      return { value: [data.issues] };
    }
    if (path === `${API}labels?per_page=100`) {
      return { value: [data.labels ?? []] };
    }
    if (path.endsWith('/dependencies/blocked_by?per_page=100')) {
      return { value: [data.blockers?.[path.split('/')[4] ?? ''] ?? []] };
    }
    if (path.startsWith(`${API}milestones/`)) {
      return { value: data.currentMilestone ?? milestones.find((value) => value.number === last) };
    }
    if (path.startsWith(`${API}issues/`)) {
      return { value: data.currentIssue ?? issues.find((value) => value.number === last) };
    }
  }
  if (method === 'PATCH' && path.startsWith(`${API}issues/`)) {
    const chosen =
      typeof body === 'object' && body !== null && 'milestone' in body ? body.milestone : undefined;
    return {
      value: data.patchResponse ?? {
        ...issues.find((value) => value.number === last),
        milestone: milestones.find((value) => value.number === chosen),
      },
    };
  }
  if (method === 'POST' && path === `${API}labels`) {
    return { value: body };
  }
  return undefined;
}
