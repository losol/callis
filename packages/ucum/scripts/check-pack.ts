/**
 * Checks the packed package as npm would publish it: the UCUM file, the license and the notices
 * are included unchanged, the bundled string is the essence file byte for byte, and the packed
 * module converts units. Run after `pnpm build` (it is part of `check:package`).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface SourceFile {
  readonly packagePath: string;
  readonly sha256: string;
}

const packageDir = fileURLToPath(new URL('../', import.meta.url));
const coreDir = fileURLToPath(new URL('../../core/', import.meta.url));
const source = JSON.parse(readFileSync(join(packageDir, 'data/source.json'), 'utf8')) as {
  readonly files: Readonly<Record<string, SourceFile>>;
};
const REQUIRED = [
  'package.json',
  'README.md',
  'LICENSE.md',
  'SOURCE.md',
  'UCUM-LICENSE.md',
  'data/source.json',
  'data/ucum-essence.xml',
  'dist/index.js',
  'dist/index.d.ts',
  'dist/essence/ucum-essence-xml.js',
];

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const failures: string[] = [];
const temp = mkdtempSync(join(tmpdir(), 'callis-ucum-pack-'));
try {
  execFileSync('pnpm', ['pack', '--pack-destination', temp], { cwd: packageDir, stdio: 'ignore' });
  const tarball = readdirSync(temp).find((file) => file.endsWith('.tgz'));
  if (tarball === undefined) throw new Error('pnpm pack wrote no tarball');
  const modules = join(temp, 'node_modules', '@callis');
  mkdirSync(modules, { recursive: true });
  execFileSync('tar', ['-xzf', join(temp, tarball), '-C', modules]);
  const packed = join(modules, 'ucum');
  renameSync(join(modules, 'package'), packed);
  // The packed module imports its peer @callis/core; link the built workspace package.
  symlinkSync(coreDir, join(modules, 'core'), 'dir');

  for (const file of REQUIRED) {
    if (!statSync(join(packed, file), { throwIfNoEntry: false })?.isFile()) {
      failures.push(`missing ${file}`);
    }
  }
  for (const [name, file] of Object.entries(source.files)) {
    const path = join(packed, file.packagePath);
    if (statSync(path, { throwIfNoEntry: false }) && sha256(readFileSync(path)) !== file.sha256) {
      failures.push(`${file.packagePath} is not the pinned ${name}`);
    }
  }
  const manifest = JSON.parse(readFileSync(join(packed, 'package.json'), 'utf8')) as {
    readonly license?: string;
    readonly dependencies?: Readonly<Record<string, string>>;
  };
  if (manifest.license !== 'MIT AND LicenseRef-UCUM') failures.push('unexpected license field');
  if (Object.keys(manifest.dependencies ?? {}).length > 0) failures.push('runtime dependencies');
  const bundled = readFileSync(join(packed, 'dist/essence/ucum-essence-xml.js'), 'utf8');
  if (
    !bundled.includes('Regenstrief Institute') ||
    !bundled.includes('UCUM License, Version 1.1')
  ) {
    failures.push('dist/essence/ucum-essence-xml.js lacks the UCUM notice');
  }

  const essence = (await import(
    pathToFileURL(join(packed, 'dist/essence/ucum-essence-xml.js')).href
  )) as {
    readonly UCUM_ESSENCE_XML?: unknown;
  };
  const embedded = essence.UCUM_ESSENCE_XML;
  if (
    typeof embedded !== 'string' ||
    sha256(Buffer.from(embedded, 'latin1')) !== source.files['ucum-essence.xml']?.sha256
  ) {
    failures.push('the bundled essence string is not the pinned file');
  }
  const { ucum } = (await import(pathToFileURL(join(packed, 'dist/index.js')).href)) as {
    readonly ucum: import('@callis/core').UnitSystem;
  };
  const { Decimal } = (await import(pathToFileURL(join(modules, 'core/dist/index.js')).href)) as {
    readonly Decimal: typeof import('@callis/core').Decimal;
  };
  if (ucum.convert(Decimal.ONE, 'kg', 'g')?.toString() !== '1000') {
    failures.push('the packed module does not convert kg to g');
  }
  if (ucum.compare?.(Decimal.of(23n), 'Cel', Decimal.of(734n, 1), '[degF]') !== 0) {
    failures.push('the packed module does not compare Cel with [degF]');
  }
  const size = statSync(join(temp, tarball)).size;
  console.log(`Packed ${tarball}: ${(size / 1024).toFixed(2)} kB`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
console.log('✓ The packed package contains the unchanged UCUM file, its license and notices');
