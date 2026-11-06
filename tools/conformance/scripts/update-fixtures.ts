/**
 * Vendors the HL7 FHIRPath test suite from FHIR/fhir-test-cases into `fixtures/`: both suite files,
 * every input file they reference, the test schema and the license. Writes `fixtures/source.json`
 * (commit and checksums) and `fixtures/SOURCE.md`, and deletes files that an earlier run vendored
 * but the new commit no longer references. Converted inputs (T0023) are left alone.
 *
 * Usage: `pnpm --filter @callis/conformance update-fixtures [--ref <branch, tag or commit>]`
 * (default `master`). Set `GITHUB_TOKEN` to avoid the API rate limit.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { FIXTURES_DIR, type FixtureSource, type VendoredFile } from '../src/fixtures.ts';
import { compareOrdinal } from '../src/ordinal.ts';
import { parseSuite } from '../src/parse-suite.ts';
import { allTests, SUITE_FILE_NAMES, SUITE_IDS } from '../src/suite.ts';

const REPOSITORY = 'FHIR/fhir-test-cases';

/** Files vendored besides the inputs: path in `fixtures/` → path upstream. */
const FIXED_FILES: Readonly<Record<string, string>> = {
  'LICENSE.txt': 'LICENSE.txt',
  'r4/tests-fhir-r4.xml': 'r4/fhirpath/tests-fhir-r4.xml',
  'r5/tests-fhir-r5.xml': 'r5/fhirpath/tests-fhir-r5.xml',
  'r5/testSchema.xsd': 'r5/fhirpath/testSchema.xsd',
};

/** Input file names must be plain file names, so a suite file cannot write outside `fixtures/`. */
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const { values } = parseArgs({ options: { ref: { type: 'string', default: 'master' } } });
const { commit, commitDate } = await resolveCommit(values.ref);
console.log(`Vendoring ${REPOSITORY} at ${commit} (${commitDate})`);

const previous = readPreviousSource();
const files: Record<string, VendoredFile> = {};

for (const [target, upstream] of Object.entries(FIXED_FILES)) {
  files[target] = await vendor(target, upstream);
}

for (const id of SUITE_IDS) {
  const fileName = SUITE_FILE_NAMES[id];
  const suite = parseSuite(readFileSync(join(FIXTURES_DIR, id, fileName), 'utf8'), id, fileName);
  const inputs = new Set(allTests(suite).flatMap((test) => test.inputFile ?? []));
  for (const input of [...inputs].sort()) {
    if (!SAFE_FILE_NAME.test(input)) {
      throw new Error(`${fileName}: refusing to vendor unsafe input file name ${input}`);
    }
    files[`${id}/${input}`] = await vendor(`${id}/${input}`, `${id}/${input}`);
  }
}

for (const stale of Object.keys(previous?.files ?? {})) {
  if (!Object.hasOwn(files, stale)) {
    rmSync(join(FIXTURES_DIR, stale), { force: true });
    console.log(`  removed ${stale}`);
  }
}

const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => compareOrdinal(a, b)));
const source: FixtureSource = { repository: REPOSITORY, commit, commitDate, files: sorted };
writeFileSync(join(FIXTURES_DIR, 'source.json'), `${JSON.stringify(source, null, 2)}\n`);
writeFileSync(join(FIXTURES_DIR, 'SOURCE.md'), renderSourceMarkdown(source));
console.log(
  `Vendored ${Object.keys(files).length} files. Now run \`pnpm --filter @callis/conformance convert-fixtures\` and \`pnpm conformance\`.`,
);

async function resolveCommit(ref: string): Promise<{ commit: string; commitDate: string }> {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN;
  if (token !== undefined && token !== '') {
    headers.authorization = `Bearer ${token}`;
  }
  const url = `https://api.github.com/repos/${REPOSITORY}/commits/${encodeURIComponent(ref)}`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GET ${url}: ${response.status} ${response.statusText}`);
  }
  const body: unknown = await response.json();
  const sha = property(body, 'sha');
  const date = property(property(property(body, 'commit'), 'committer'), 'date');
  if (typeof sha !== 'string' || typeof date !== 'string') {
    throw new Error(`GET ${url}: unexpected response`);
  }
  return { commit: sha, commitDate: date };
}

function property(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, name)
    ? Reflect.get(value, name)
    : undefined;
}

async function vendor(target: string, upstream: string): Promise<VendoredFile> {
  const url = `https://raw.githubusercontent.com/${REPOSITORY}/${commit}/${upstream}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url}: ${response.status} ${response.statusText}`);
  }
  const content = new Uint8Array(await response.arrayBuffer());
  const path = join(FIXTURES_DIR, target);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`  ${target}`);
  return { upstream, sha256: createHash('sha256').update(content).digest('hex') };
}

function readPreviousSource(): FixtureSource | undefined {
  const path = join(FIXTURES_DIR, 'source.json');
  if (!existsSync(path)) {
    return undefined;
  }
  const source: FixtureSource = JSON.parse(readFileSync(path, 'utf8'));
  return source;
}

function renderSourceMarkdown(source: FixtureSource): string {
  const base = `https://github.com/${source.repository}`;
  const rows = Object.entries(source.files).map(
    ([target, file]) =>
      `| \`${target}\` | [\`${file.upstream}\`](${base}/blob/${source.commit}/${file.upstream}) |`,
  );
  return `# Vendored HL7 FHIRPath test suite

<!-- Generated by \`pnpm --filter @callis/conformance update-fixtures\`. Do not edit by hand. -->

These files are unchanged copies from [${source.repository}](${base}) at commit [\`${source.commit}\`](${base}/tree/${source.commit}) (${source.commitDate}).

- \`r5/tests-fhir-r5.xml\` is the source of truth for the suite; \`r4/tests-fhir-r4.xml\` is the R4 copy.
- Each suite's input files are in the same folder as the suite file, taken from \`r4/\` and \`r5/\` upstream.
- [\`source.json\`](source.json) records the commit and the SHA-256 of every file; a unit test checks that the files are unchanged.
- To update, run \`pnpm --filter @callis/conformance update-fixtures --ref <commit>\` and commit the result in its own PR.
- A \`name.json\` next to an XML input \`name.xml\` is not vendored: it is converted from the XML by T0023.

## License

${source.repository} is licensed under the Apache License, Version 2.0. A copy of the license is in [\`LICENSE.txt\`](LICENSE.txt). The vendored files are not modified; JSON files converted from the XML inputs are derived from them and are distributed under the same license.

## Files

| File | Upstream |
| --- | --- |
${rows.join('\n')}
`;
}
