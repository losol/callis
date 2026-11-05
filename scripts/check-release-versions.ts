/**
 * Fails if a public workspace package has a version below 0.1.0, so the release workflow cannot
 * publish it (RELEASING.md). `pnpm release` runs this before it builds and publishes.
 *
 * Usage: `pnpm check:release`.
 */
import { execFileSync } from 'node:child_process';
import {
  findReleaseVersionProblems,
  MINIMUM_RELEASE_VERSION,
  type WorkspaceProject,
} from './release-versions.ts';

// pnpm's own list of the workspace projects, so the check sees exactly what Changesets sees.
const output = execFileSync('pnpm', ['ls', '--recursive', '--depth', '-1', '--json'], {
  encoding: 'utf8',
});
const projects = JSON.parse(output) as WorkspaceProject[];
const problems = findReleaseVersionProblems(projects);

if (problems.length > 0) {
  for (const { name, reason } of problems) {
    // The ::error prefix becomes an annotation in GitHub Actions; elsewhere it is plain text.
    console.error(`::error title=Release guard::${name} ${reason}.`);
  }
  console.error(
    `✗ Nothing below ${MINIMUM_RELEASE_VERSION} is published. Add a minor changeset and release ` +
      'through the version PR. See RELEASING.md.',
  );
  process.exit(1);
}
const published = projects.filter((project) => project.private !== true);
console.log(
  `✓ Every public package is at ${MINIMUM_RELEASE_VERSION} or later: ` +
    published.map((project) => `${project.name}@${project.version}`).join(', '),
);
