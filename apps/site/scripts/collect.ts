// Collects what the site shows into `.lectio/`: the documents and their manifest,
// the search index, and the progress data. Run before every dev and build.
//
// The conformance reports (`docs/conformance/r4.md`, `r5.md`) are generated, never committed:
// the first step writes them, so the collected documents and the published URLs
// (/conformance/r4, /conformance/r5) always show the engine of this checkout.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { collect } from '@eventuras/lectio-docs';
import { buildSearchIndex } from '@eventuras/lectio-docs/build-index';

import docsConfig from '../docs.config.ts';
import { type ConformanceTests, parseTestResults } from '../progress/conformance.ts';
import { collectProgress, repositoryRoot } from '../progress/git.ts';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = repositoryRoot(appDir);
const contentDir = join(appDir, '.lectio');

const conformance = generateConformance();

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
const progress = collectProgress(root, ref, conformance);
writeFileSync(join(contentDir, 'progress.json'), `${JSON.stringify(progress)}\n`);
console.log(
  `Progress: ${progress.commits.length} commits and ${progress.plan.length} tasks from ${ref}`,
);

/**
 * Runs the HL7 test suites with the engine of this checkout, as `pnpm conformance` does (the same
 * command, in the same way: the engine and `@callis/ucum` run from source, so no build is needed),
 * and writes the reports to `docs/conformance/`. `--reports-only` reads no baseline, so a
 * regression in a work in progress does not stop the site. Returns the tests of the suites, for
 * the progress of the commits that have only a baseline.
 */
function generateConformance(): ConformanceTests {
  const tool = join(root, 'tools', 'conformance', 'src');
  const scratch = mkdtempSync(join(tmpdir(), 'callis-site-'));
  try {
    const results = join(scratch, 'results.json');
    execFileSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(join(tool, 'core-source.ts')).href,
        join(tool, 'cli.ts'),
        '--reports-only',
        '--results',
        results,
      ],
      { cwd: root, stdio: 'inherit' },
    );
    return parseTestResults(readFileSync(results, 'utf8'));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
