/**
 * PR-title rules from CONTRIBUTING.md ("Pull request titles and commit messages"). The PR title
 * becomes the commit subject on `main`, so CI checks it with these rules.
 */

/** Allowed Conventional Commits types. */
export const TYPES: readonly string[] = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'test',
  'docs',
  'build',
  'ci',
  'chore',
  'revert',
];

/** Allowed scopes: the package, app and tool directories. */
export const SCOPES: readonly string[] = [
  'core',
  'ucum',
  'fhir-r4',
  'fhir-r5',
  'fhir-r6',
  'cli',
  'conformance',
  'model-gen',
  'site',
];

/** Types that may omit the scope for repository-wide changes. */
const SCOPE_OPTIONAL_TYPES: ReadonlySet<string> = new Set(['docs', 'build', 'ci', 'chore']);

const MAX_LENGTH = 72;

const HEADER = /^(?<type>[^(!:\s]+)(?:\((?<scope>[^()]*)\))?(?<breaking>!)?: (?<summary>.*)$/;

/** Returns the problems with a PR title, or an empty array if it follows the rules. */
export function validatePrTitle(title: string): string[] {
  const problems: string[] = [];

  const length = [...title].length;
  if (length > MAX_LENGTH) {
    problems.push(`The title has ${length} characters; the limit is ${MAX_LENGTH}.`);
  }

  const groups = HEADER.exec(title)?.groups;
  const type = groups?.type;
  const summary = groups?.summary;
  if (type === undefined || summary === undefined) {
    problems.push(
      'Use the form "<type>(<scope>): <summary>", for example "feat(core): add lexer".',
    );
    return problems;
  }

  if (!TYPES.includes(type)) {
    problems.push(`Unknown type "${type}". Use one of: ${TYPES.join(', ')}.`);
  }

  const scope = groups?.scope;
  if (scope === undefined) {
    if (TYPES.includes(type) && !SCOPE_OPTIONAL_TYPES.has(type)) {
      problems.push(
        `"${type}" needs a scope, for example "${type}(core): …". Only docs, build, ci and chore may omit it.`,
      );
    }
  } else if (scope.includes(',')) {
    problems.push(
      `Use exactly one scope, not "${scope}". A change to two scopes is usually two PRs.`,
    );
  } else if (!SCOPES.includes(scope)) {
    problems.push(`Unknown scope "${scope}". Use one of: ${SCOPES.join(', ')}.`);
  }

  if (!/^[a-z]/.test(summary)) {
    problems.push('Start the summary with a lowercase letter, for example "add lexer".');
  }
  if (summary.endsWith('.')) {
    problems.push('Do not end the summary with a period.');
  }

  return problems;
}
