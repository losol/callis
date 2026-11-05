// Collects what the site shows into `.lectio/`: the documents and their manifest,
// the search index, and the progress data. Run before every dev and build.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collect } from '@eventuras/lectio-docs';
import { buildSearchIndex } from '@eventuras/lectio-docs/build-index';

import docsConfig from '../docs.config.ts';
import { collectProgress, repositoryRoot } from '../progress/git.ts';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = repositoryRoot(appDir);
const contentDir = join(appDir, '.lectio');

await collect({ rootDir: root, configDir: appDir, config: docsConfig });

mkdirSync(join(appDir, 'public'), { recursive: true });
await buildSearchIndex({
  contentDir,
  outputPath: join(appDir, 'public', 'search-index.json'),
  log: (message) => console.log(message),
});

// `HEAD` is what the checkout holds: `main` in the deploy, the PR branch in CI.
// A shallow checkout has too little history, so the build says so.
const ref = process.env.PROGRESS_REF ?? 'HEAD';
const progress = collectProgress(root, ref);
writeFileSync(join(contentDir, 'progress.json'), `${JSON.stringify(progress)}\n`);
console.log(
  `Progress: ${progress.commits.length} commits and ${progress.plan.length} tasks from ${ref}`,
);
