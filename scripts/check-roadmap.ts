/**
 * Checks that `docs/roadmap.md` and the task files agree (see `roadmap.ts`).
 *
 * Usage: `pnpm check:roadmap`. CI runs it on every PR.
 */
import { loadRoadmap } from './roadmap.ts';

const { roadmap, problems } = loadRoadmap(new URL('..', import.meta.url).pathname);

if (problems.length > 0) {
  for (const problem of problems) {
    // The ::error prefix becomes an annotation in GitHub Actions; elsewhere it is plain text.
    console.error(`::error title=Roadmap::${problem}`);
  }
  console.error('See CONTRIBUTING.md, "Roadmap sync".');
  process.exit(1);
}
console.log(`✓ docs/roadmap.md and ${roadmap.tasks.length} task files agree`);
