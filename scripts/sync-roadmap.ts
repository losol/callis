/**
 * Copies the roadmap to GitHub: one task issue per task with the `task` and wave labels,
 * "blocked by" links for its dependencies, and the task's fields on the project board. The
 * roadmap is the source of truth, so the sync only ever changes GitHub. It never rewrites issue
 * bodies, closes issues or deletes anything except stale wave labels and stale "blocked by" links
 * between task issues. See CONTRIBUTING.md, "Roadmap sync".
 *
 * Usage:
 *   pnpm sync:roadmap                  show what would change, without changing anything
 *   pnpm sync:roadmap --apply          make the changes
 *   pnpm sync:roadmap --skip-project   leave the project board alone
 *
 * Needs the GitHub CLI (`gh`) logged in with the `repo` and `project` scopes, or a token in
 * `GH_TOKEN` with the same access.
 */
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import {
  issueBody,
  issueLabels,
  issueTitle,
  loadRoadmap,
  PROJECT_FIELDS,
  type ProjectFieldName,
  projectFieldValues,
  REPOSITORY,
  type RoadmapTask,
  setDiff,
  TEXT_FIELDS,
  taskIdOfIssueTitle,
  waveLabel,
} from './roadmap.ts';

const PROJECT_OWNER = 'losol';
const PROJECT_TITLE = 'Callis roadmap';
const PROJECT_DESCRIPTION = 'Callis tasks. Synced from docs/roadmap.md by `pnpm sync:roadmap`.';
const WAVE_LABEL_COLOR = 'C5DEF5';
/** Pause between writes, to stay below GitHub's secondary rate limits. */
const WRITE_PAUSE_MS = 400;

interface RestIssue {
  readonly number: number;
  readonly id: number;
  readonly node_id: string;
  readonly title: string;
  readonly state: 'open' | 'closed';
  readonly labels: readonly { readonly name: string }[];
  readonly pull_request?: unknown;
}

interface ProjectField {
  readonly id: string;
  readonly name: string;
  readonly options?: readonly { readonly id: string; readonly name: string }[];
}

interface ProjectItem {
  readonly id: string;
  readonly values: ReadonlyMap<string, string>;
}

const { values: flags } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    'skip-project': { type: 'boolean', default: false },
  },
});
const apply = flags.apply;
const changes: string[] = [];
/**
 * The writes to GitHub that have succeeded so far. A change can take more than one write (creating
 * the project also sets its description), so these are counted where the API is called.
 */
let writes = 0;

/** Records a change, and makes it when `--apply` is given. */
function change<T>(description: string, run: () => T): T | undefined {
  changes.push(description);
  console.log(`${apply ? '' : '(dry run) '}${description}`);
  if (!apply) {
    return undefined;
  }
  const result = run();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, WRITE_PAUSE_MS);
  return result;
}

/** Runs `gh` and parses its JSON output. `body` is sent as the request body. */
function gh(args: readonly string[], body?: unknown): unknown {
  let output: string;
  try {
    output = execFileSync('gh', body === undefined ? args : [...args, '--input', '-'], {
      encoding: 'utf8',
      input: body === undefined ? '' : JSON.stringify(body),
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(`gh ${args.slice(0, 4).join(' ')} failed: ${ghErrorMessage(error)}`, {
      cause: error,
    });
  }
  return output.trim() === '' ? undefined : JSON.parse(output);
}

/**
 * What a failed `gh` call reported: its own message on stderr, such as
 * `gh: Validation Failed (HTTP 422)`, followed by the details of the API's error response that
 * stderr leaves out (`Label.name already_exists`, or a GraphQL error with its path). Falls back to
 * the process error when `gh` printed nothing.
 */
function ghErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const stderr =
    'stderr' in error && typeof error.stderr === 'string'
      ? error.stderr.trim().replace(/\s*\n\s*/g, ' ')
      : '';
  const body = 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : '';
  const details = apiErrorDetails(body).filter((detail) => !stderr.includes(detail));
  const parts = stderr === '' ? details : [stderr, ...details];
  return parts.length > 0 ? parts.join('; ') : error.message;
}

/** The errors in an API response body, as text, without repeats. */
function apiErrorDetails(body: string): string[] {
  let response: unknown;
  try {
    response = JSON.parse(body);
  } catch {
    // Not a JSON response body, so it has no error details; stderr still tells what failed.
    return [];
  }
  const details = new Set<string>();
  collectErrorDetails(response, details);
  return [...details];
}

/**
 * Adds the error described by a REST or GraphQL error object, then those in its `errors` list. A
 * REST validation error names a resource, field and code; a GraphQL error has a path.
 */
function collectErrorDetails(value: unknown, details: Set<string>): void {
  if (typeof value === 'string') {
    details.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectErrorDetails(item, details);
    }
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  const fields = new Map<string, unknown>(Object.entries(value));
  const text = [fields.get('message'), fields.get('code')].find(
    (field) => typeof field === 'string',
  );
  if (typeof text === 'string') {
    const subject = [fields.get('resource'), fields.get('field')]
      .filter((field) => typeof field === 'string')
      .join('.');
    const path = fields.get('path');
    const at = Array.isArray(path) ? ` at ${path.join('.')}` : '';
    details.add(`${subject === '' ? '' : `${subject} `}${text}${at}`);
  }
  collectErrorDetails(fields.get('errors'), details);
}

/**
 * Calls the REST API. The result is cast to the type the caller names: the types in this file
 * describe the documented response fields that the sync reads.
 */
function rest<T>(method: string, path: string, body?: unknown): T {
  const result = gh(['api', '--method', method, path], body) as T;
  if (method !== 'GET') {
    writes++;
  }
  return result;
}

function restList<T>(path: string): T[] {
  return (gh(['api', '--paginate', '--slurp', path]) as T[][]).flat();
}

function graphql<T>(query: string, variables: Record<string, unknown> = {}): T {
  const result = (gh(['api', 'graphql'], { query, variables }) as { data: T }).data;
  if (query.trimStart().startsWith('mutation')) {
    writes++;
  }
  return result;
}

// --- Issues and labels ---

function syncWaveLabels(tasks: readonly RoadmapTask[]): void {
  const existing = new Set(
    restList<{ name: string }>(`repos/${REPOSITORY}/labels?per_page=100`).map((l) => l.name),
  );
  for (const label of new Set(tasks.map(waveLabel))) {
    if (!existing.has(label)) {
      change(`+ label ${label}`, () =>
        rest('POST', `repos/${REPOSITORY}/labels`, {
          name: label,
          color: WAVE_LABEL_COLOR,
          description: `Roadmap wave ${label.slice('wave-'.length)}`,
        }),
      );
    }
  }
}

function readTaskIssues(): Map<string, RestIssue> {
  const issues = new Map<string, RestIssue>();
  const all = restList<RestIssue>(`repos/${REPOSITORY}/issues?state=all&labels=task&per_page=100`);
  for (const issue of all) {
    const id = taskIdOfIssueTitle(issue.title);
    if (issue.pull_request !== undefined || id === undefined) {
      continue;
    }
    const other = issues.get(id);
    if (other !== undefined) {
      throw new Error(`${id} has two task issues, #${other.number} and #${issue.number}.`);
    }
    issues.set(id, issue);
  }
  return issues;
}

function syncIssue(task: RoadmapTask, issue: RestIssue | undefined): RestIssue | undefined {
  if (issue === undefined) {
    return change(`+ issue "${issueTitle(task)}"`, () =>
      rest<RestIssue>('POST', `repos/${REPOSITORY}/issues`, {
        title: issueTitle(task),
        body: issueBody(task),
        labels: issueLabels(task, []),
      }),
    );
  }

  const title = issueTitle(task);
  if (issue.title !== title) {
    change(`~ #${issue.number} title "${issue.title}" → "${title}"`, () =>
      rest('PATCH', `repos/${REPOSITORY}/issues/${issue.number}`, { title }),
    );
  }

  const current = issue.labels.map((l) => l.name);
  const labels = issueLabels(task, current);
  const diff = setDiff(current, labels);
  if (diff.add.length > 0 || diff.remove.length > 0) {
    change(`~ #${issue.number} labels ${current.join(', ')} → ${labels.join(', ')}`, () =>
      rest('PATCH', `repos/${REPOSITORY}/issues/${issue.number}`, { labels }),
    );
  }
  return issue;
}

function syncBlockedBy(
  task: RoadmapTask,
  issue: RestIssue | undefined,
  issues: ReadonlyMap<string, RestIssue>,
): void {
  const name = issue === undefined ? task.id : `#${issue.number}`;
  const desired = new Map<number, RestIssue>();
  for (const dep of task.dependsOn) {
    const depIssue = issues.get(dep);
    if (depIssue === undefined) {
      changes.push(`${name} blocked by ${dep}`);
      console.log(`(dry run) + ${name} blocked by ${dep} (new issue)`);
    } else {
      desired.set(depIssue.number, depIssue);
    }
  }

  const current =
    issue === undefined
      ? []
      : restList<RestIssue>(
          `repos/${REPOSITORY}/issues/${issue.number}/dependencies/blocked_by?per_page=100`,
        );
  const taskIssueNumbers = new Set([...issues.values()].map((i) => i.number));
  // Only links between task issues belong to the roadmap; leave other "blocked by" links alone.
  const currentTaskBlockers = current.filter((i) => taskIssueNumbers.has(i.number));
  const diff = setDiff(
    currentTaskBlockers.map((i) => i.number),
    desired.keys(),
  );

  for (const number of diff.add) {
    const blocker = desired.get(number);
    if (blocker === undefined) {
      continue;
    }
    change(`+ ${name} blocked by #${number}`, () => {
      if (issue !== undefined) {
        rest('POST', `repos/${REPOSITORY}/issues/${issue.number}/dependencies/blocked_by`, {
          issue_id: blocker.id,
        });
      }
    });
  }
  for (const number of diff.remove) {
    const blocker = currentTaskBlockers.find((i) => i.number === number);
    if (blocker === undefined || issue === undefined) {
      continue;
    }
    change(`- ${name} blocked by #${number}`, () =>
      rest(
        'DELETE',
        `repos/${REPOSITORY}/issues/${issue.number}/dependencies/blocked_by/${blocker.id}`,
      ),
    );
  }
}

// --- Project board ---

function findProject(): { id: string; url: string } | undefined {
  const data = graphql<{
    organization: { projectsV2: { nodes: { id: string; title: string; url: string }[] } };
  }>(
    `query($login: String!) {
      organization(login: $login) { projectsV2(first: 100) { nodes { id title url } } }
    }`,
    { login: PROJECT_OWNER },
  );
  return data.organization.projectsV2.nodes.find((p) => p.title === PROJECT_TITLE);
}

function createProject(): { id: string; url: string } | undefined {
  return change(`+ project "${PROJECT_TITLE}" in ${PROJECT_OWNER}, linked to ${REPOSITORY}`, () => {
    const [owner, name] = REPOSITORY.split('/');
    const ids = graphql<{ organization: { id: string }; repository: { id: string } }>(
      `query($login: String!, $owner: String!, $name: String!) {
        organization(login: $login) { id }
        repository(owner: $owner, name: $name) { id }
      }`,
      { login: PROJECT_OWNER, owner, name },
    );
    const created = graphql<{ createProjectV2: { projectV2: { id: string; url: string } } }>(
      `mutation($owner: ID!, $repo: ID!, $title: String!) {
        createProjectV2(input: { ownerId: $owner, repositoryId: $repo, title: $title }) {
          projectV2 { id url }
        }
      }`,
      { owner: ids.organization.id, repo: ids.repository.id, title: PROJECT_TITLE },
    ).createProjectV2.projectV2;
    graphql(
      `mutation($id: ID!, $description: String!) {
        updateProjectV2(input: { projectId: $id, shortDescription: $description }) {
          projectV2 { id }
        }
      }`,
      { id: created.id, description: PROJECT_DESCRIPTION },
    );
    return created;
  });
}

function readFields(projectId: string): Map<string, ProjectField> {
  const data = graphql<{ node: { fields: { nodes: ProjectField[] } } }>(
    `query($id: ID!) {
      node(id: $id) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2Field { id name }
              ... on ProjectV2IterationField { id name }
              ... on ProjectV2SingleSelectField { id name options { id name } }
            }
          }
        }
      }
    }`,
    { id: projectId },
  );
  return new Map(data.node.fields.nodes.map((field) => [field.name, field]));
}

/** The single-select options a field needs, in board order. */
function fieldOptions(field: ProjectFieldName, tasks: readonly RoadmapTask[]): string[] {
  const values = [...new Set(tasks.map((task) => projectFieldValues(task)[field]))];
  const order = ['S', 'M', 'L'];
  return values.sort((a, b) =>
    field === 'Size' ? order.indexOf(a) - order.indexOf(b) : Number(a) - Number(b),
  );
}

function syncFields(projectId: string, tasks: readonly RoadmapTask[]): Map<string, ProjectField> {
  const fields = readFields(projectId);
  let created = false;
  for (const name of PROJECT_FIELDS) {
    const field = fields.get(name);
    const isText = TEXT_FIELDS.has(name);
    const options = isText ? [] : fieldOptions(name, tasks);
    if (field === undefined) {
      created = true;
      change(`+ project field ${name}${isText ? '' : ` (${options.join(', ')})`}`, () =>
        graphql(
          `mutation($input: CreateProjectV2FieldInput!) {
            createProjectV2Field(input: $input) { clientMutationId }
          }`,
          {
            input: {
              projectId,
              name,
              dataType: isText ? 'TEXT' : 'SINGLE_SELECT',
              ...(isText
                ? {}
                : {
                    singleSelectOptions: options.map((option) => ({
                      name: option,
                      color: 'GRAY',
                      description: '',
                    })),
                  }),
            },
          },
        ),
      );
      continue;
    }
    const existing = new Set((field.options ?? []).map((option) => option.name));
    const missing = options.filter((option) => !existing.has(option));
    if (missing.length > 0) {
      // Replacing the options through the API can clear the values already set, so this is a
      // one-off manual step.
      throw new Error(
        `The project field ${name} has no option ${missing.join(', ')}. Add it in the project settings and run the sync again.`,
      );
    }
  }
  return created && apply ? readFields(projectId) : fields;
}

function readItems(projectId: string): Map<number, ProjectItem> {
  const items = new Map<number, ProjectItem>();
  let after: string | null = null;
  do {
    const page: {
      node: {
        items: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: {
            id: string;
            content: { number?: number; repository?: { nameWithOwner: string } } | null;
            fieldValues: {
              nodes: { text?: string; name?: string; field?: { name: string } }[];
            };
          }[];
        };
      };
    } = graphql(
      `query($id: ID!, $after: String) {
        node(id: $id) {
          ... on ProjectV2 {
            items(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                content { ... on Issue { number repository { nameWithOwner } } }
                fieldValues(first: 30) {
                  nodes {
                    ... on ProjectV2ItemFieldTextValue {
                      text
                      field { ... on ProjectV2FieldCommon { name } }
                    }
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field { ... on ProjectV2FieldCommon { name } }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { id: projectId, after },
    );
    for (const node of page.node.items.nodes) {
      const number = node.content?.number;
      if (number === undefined || node.content?.repository?.nameWithOwner !== REPOSITORY) {
        continue;
      }
      const values = new Map<string, string>();
      for (const value of node.fieldValues.nodes) {
        const text = value.text ?? value.name;
        if (value.field !== undefined && text !== undefined) {
          values.set(value.field.name, text);
        }
      }
      items.set(number, { id: node.id, values });
    }
    after = page.node.items.pageInfo.hasNextPage ? page.node.items.pageInfo.endCursor : null;
  } while (after !== null);
  return items;
}

function setFieldValue(
  projectId: string,
  itemId: string | undefined,
  field: ProjectField | undefined,
  value: string,
): void {
  if (itemId === undefined || field === undefined) {
    return;
  }
  const option = field.options?.find((o) => o.name === value);
  if (field.options !== undefined && option === undefined) {
    throw new Error(`The project field ${field.name} has no option ${value}.`);
  }
  graphql(
    `mutation($input: UpdateProjectV2ItemFieldValueInput!) {
      updateProjectV2ItemFieldValue(input: $input) { clientMutationId }
    }`,
    {
      input: {
        projectId,
        itemId,
        fieldId: field.id,
        value: option === undefined ? { text: value } : { singleSelectOptionId: option.id },
      },
    },
  );
}

function syncProject(
  tasks: readonly RoadmapTask[],
  issues: ReadonlyMap<string, RestIssue>,
): string | undefined {
  const project = findProject() ?? createProject();
  if (project === undefined) {
    console.log('(dry run) The project does not exist yet, so its fields and items are skipped.');
    return undefined;
  }
  const fields = syncFields(project.id, tasks);
  const items = readItems(project.id);

  for (const task of tasks) {
    const issue = issues.get(task.id);
    if (issue === undefined) {
      continue;
    }
    const existing = items.get(issue.number);
    const itemId =
      existing?.id ??
      change(
        `+ project item #${issue.number}`,
        () =>
          graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
            `mutation($project: ID!, $content: ID!) {
            addProjectV2ItemById(input: { projectId: $project, contentId: $content }) {
              item { id }
            }
          }`,
            { project: project.id, content: issue.node_id },
          ).addProjectV2ItemById.item.id,
      );

    const desired: Record<string, string> = projectFieldValues(task);
    // Status belongs to whoever works on the task; the sync only fills it in when it is empty.
    if (existing?.values.get('Status') === undefined) {
      desired.Status = issue.state === 'closed' ? 'Done' : 'Todo';
    }
    for (const [name, value] of Object.entries(desired)) {
      const current = existing?.values.get(name);
      if (current !== value) {
        change(`~ #${issue.number} ${name}: ${current ?? '(empty)'} → ${value}`, () =>
          setFieldValue(project.id, itemId, fields.get(name), value),
        );
      }
    }
  }
  return project.url;
}

// --- Main ---

const { roadmap, problems } = loadRoadmap(new URL('..', import.meta.url).pathname);
if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`✗ ${problem}`);
  }
  console.error('Fix the roadmap first (pnpm check:roadmap).');
  process.exit(1);
}

// The project board is the only part that uses GraphQL and the `project` token scope.
let syncingProject = false;
try {
  syncWaveLabels(roadmap.tasks);

  const issues = readTaskIssues();
  for (const task of roadmap.tasks) {
    const issue = syncIssue(task, issues.get(task.id));
    if (issue !== undefined) {
      issues.set(task.id, issue);
    }
  }
  for (const task of roadmap.tasks) {
    syncBlockedBy(task, issues.get(task.id), issues);
  }

  syncingProject = !flags['skip-project'];
  const projectUrl = syncingProject ? syncProject(roadmap.tasks, issues) : undefined;
  syncingProject = false;

  const summary =
    changes.length === 0 ? 'GitHub already matches the roadmap' : `${changes.length} changes`;
  console.log(
    `${apply ? '✓' : '(dry run)'} ${summary}${projectUrl === undefined ? '' : ` · ${projectUrl}`}`,
  );
  if (!apply && changes.length > 0) {
    console.log('Run with --apply to make them.');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`✗ ${message}`);
  if (syncingProject) {
    console.error(
      'This happened while syncing the project board, which needs the "project" token scope. If the token lacks it, run `gh auth refresh -h github.com -s project`, or pass --skip-project.',
    );
  }
  if (writes > 0) {
    console.error(
      `${writes} ${writes === 1 ? 'write' : 'writes'} to GitHub succeeded before the error. Run the sync again once it is fixed.`,
    );
  }
  process.exit(1);
}
