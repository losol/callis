/**
 * Checks the pending changesets: no `major` bump for a package below 1.0.0 (see `changesets.ts`).
 *
 * Usage: `pnpm check:changesets`. `pnpm check` and CI run it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkChangeset, listChangesetFiles, readWorkspaceVersions } from './changesets.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const versions = readWorkspaceVersions(root);
const files = listChangesetFiles(root);
const problems = files.flatMap((file) =>
  checkChangeset(file, readFileSync(join(root, file), 'utf8'), versions),
);

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
