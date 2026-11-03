/**
 * Checks a PR title against the rules in CONTRIBUTING.md.
 *
 * Usage: `pnpm check:title "feat(core): add lexer"`. In CI the title comes from `PR_TITLE`.
 */
import { validatePrTitle } from './pr-title.ts';

const title = process.argv[2] ?? process.env.PR_TITLE ?? '';
const problems = validatePrTitle(title);

if (problems.length > 0) {
  console.error(`✗ ${JSON.stringify(title)}`);
  for (const problem of problems) {
    // The ::error prefix becomes an annotation in GitHub Actions; elsewhere it is plain text.
    console.error(`::error title=PR title::${problem}`);
  }
  console.error('See CONTRIBUTING.md, "Pull request titles and commit messages".');
  process.exit(1);
}
console.log(`✓ ${JSON.stringify(title)}`);
