/**
 * Reports the gzip size of each published package's JavaScript in `dist/` and fails if a package
 * exceeds its budget. In GitHub Actions the table is also written to the job summary.
 */
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { listPackages } from './packages.ts';

/** Gzip budgets in bytes. Packages without a budget are only reported. */
const BUDGETS: Readonly<Record<string, number>> = {
  // Raised from 40 kB with the static analyzer (T0024a), which added about 7 kB to a bundle
  // that was already at the budget.
  '@callis/core': 50 * 1024,
  '@callis/fhir-r4': 60 * 1024,
  '@callis/fhir-r5': 60 * 1024,
  '@callis/fhir-r6': 60 * 1024,
  // About 12 kB of it is the embedded, unchanged UCUM essence file.
  '@callis/ucum': 24 * 1024,
};

function javaScriptFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.js'))
    .map((file) => join(dir, file));
}

function formatKilobytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} kB`;
}

const rows: string[] = [];
let overBudget = false;
for (const { dir, manifest } of listPackages()) {
  const distDir = join(dir, 'dist');
  if (manifest.private === true || !existsSync(distDir)) {
    continue;
  }
  const gzipBytes = javaScriptFiles(distDir).reduce(
    (total, file) => total + gzipSync(readFileSync(file)).length,
    0,
  );
  const budget = BUDGETS[manifest.name];
  const fits = budget === undefined || gzipBytes <= budget;
  overBudget ||= !fits;
  const budgetText = budget === undefined ? '–' : formatKilobytes(budget);
  rows.push(
    `| ${manifest.name} | ${formatKilobytes(gzipBytes)} | ${budgetText} | ${fits ? '✓' : '✗'} |`,
  );
}

const table = ['| Package | Gzip size | Budget | |', '| --- | ---: | ---: | :---: |', ...rows].join(
  '\n',
);
console.log(table);

const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (summaryFile !== undefined && summaryFile !== '') {
  appendFileSync(summaryFile, `### Package size\n\n${table}\n`);
}

if (overBudget) {
  console.error('✗ A package exceeds its size budget.');
  process.exit(1);
}
