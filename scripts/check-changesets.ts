/**
 * Checks that nothing releases 1.0.0 before 1.0 (see `changesets.ts`): no pending changeset gives a
 * package below 1.0.0 a `major` bump, and no public package is at 1.0.0 or above without an earlier
 * release at 1.0.0 or above. The second check covers the version PR, which has no changesets left.
 *
 * Usage: `pnpm check:changesets`. `pnpm check`, CI and the Release workflow run it. It reads the
 * release tags with git, so it needs a clone with the tags (`fetch-depth: 0` in GitHub Actions).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkChangeset,
  checkVersions,
  listChangesetFiles,
  readReleaseTags,
  readWorkspacePackages,
} from './changesets.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const packages = readWorkspacePackages(root);
const versions = new Map(packages.map(({ name, version }) => [name, version]));
const files = listChangesetFiles(root);
const problems = [
  ...files.flatMap((file) =>
    checkChangeset(file, readFileSync(join(root, file), 'utf8'), versions),
  ),
  ...checkVersions(packages, readReleaseTags(root)),
];

/** Escapes a workflow-command value; a property value also escapes `:` and `,`. */
function escapeCommand(value: string, isProperty = false): string {
  const escaped = value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  return isProperty ? escaped.replaceAll(':', '%3A').replaceAll(',', '%2C') : escaped;
}

if (problems.length > 0) {
  for (const problem of problems) {
    // The ::error prefix becomes an annotation on the file in GitHub Actions; elsewhere it is plain
    // text.
    console.error(
      `::error file=${escapeCommand(problem.file, true)},title=Changesets::${escapeCommand(problem.message)}`,
    );
  }
  console.error('See CONTRIBUTING.md, "Changesets".');
  process.exit(1);
}
console.log(`✓ ${files.length} changesets, none with a major bump before 1.0`);
console.log(`✓ ${packages.length} packages, none at 1.0.0 or above before a 1.0 release`);
