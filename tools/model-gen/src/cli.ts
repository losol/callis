import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitModel, generateModel, type StructureDefinition } from './generate.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const cache = join(root, 'tools/model-gen/.cache');
const releases = [
  {
    name: 'r4',
    version: '4.0.1',
    sha256: 'ebd7731df7d36b5b7d39d5fb6c9d77b44bb7fe5742f1a2e87f164738c3289d44',
  },
  {
    name: 'r5',
    version: '5.0.0',
    sha256: '74b27cd1bfce9e80eaceac431edf230b0945a443564fbf5512f82e5fa50a80d4',
  },
];
const check = process.argv.includes('--check');

async function download(url: string, source: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new Error(`Download failed for ${source}: HTTP ${response.status} from ${url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
mkdirSync(cache, { recursive: true });
for (const release of releases) {
  const packageName = `hl7.fhir.${release.name}.core`;
  const source = `${packageName}@${release.version}`;
  const archive = join(cache, `${source}.tgz`);
  const url = `https://packages.fhir.org/${packageName}/${release.version}`;
  const bytes = existsSync(archive) ? readFileSync(archive) : await download(url, source);
  if (createHash('sha256').update(bytes).digest('hex') !== release.sha256) {
    throw new Error(`Archive integrity mismatch for ${source}; remove ${archive} and retry`);
  }
  writeFileSync(archive, bytes);
  const staging = mkdtempSync(join(tmpdir(), 'callis-model-gen-'));
  try {
    // Extract only the trusted, checksum-pinned upstream archive, never an arbitrary input.
    execFileSync('tar', ['-xzf', archive, '-C', staging]);
    const directory = join(staging, 'package');
    const manifest: unknown = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    if (
      typeof manifest !== 'object' ||
      manifest === null ||
      !('name' in manifest) ||
      manifest.name !== packageName ||
      !('version' in manifest) ||
      manifest.version !== release.version ||
      !('license' in manifest) ||
      manifest.license !== 'CC0-1.0'
    ) {
      throw new Error(`Unexpected package identity or license: ${source}`);
    }
    // The pinned official StructureDefinition JSON is the generator's typed input boundary.
    // Semantic checks (snapshots, references, cardinalities, bases) run in generateModel.
    const definitions = readdirSync(directory)
      .filter((name) => name.startsWith('StructureDefinition-') && name.endsWith('.json'))
      .sort()
      .map(
        (name) => JSON.parse(readFileSync(join(directory, name), 'utf8')) as StructureDefinition,
      );
    const rows = generateModel(definitions);
    const output = join(root, `packages/fhir-${release.name}/src/model-data.ts`);
    const text = emitModel(rows, source);
    if (check) {
      if (!existsSync(output) || readFileSync(output, 'utf8') !== text) {
        throw new Error(
          `Generated output differs: ${output}; run pnpm --filter @callis/model-gen generate`,
        );
      }
    } else writeFileSync(output, text);
    console.log(`${source}: ${rows.length} types; ${check ? 'verified' : 'generated'} ${output}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
