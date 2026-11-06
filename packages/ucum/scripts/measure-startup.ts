/**
 * Measures what `@callis/ucum` costs: the size of its JavaScript (as built, minified and gzipped)
 * and of the packed package, and the time to read the embedded UCUM file at startup.
 *
 * Usage, after `pnpm build`: `pnpm --filter @callis/ucum measure [runs]` (default 30 runs).
 *
 * - Cold: each run is a fresh Node.js process, so nothing is compiled or cached in V8 yet. The
 *   operating system's file cache is warm after the first run. It times importing `@callis/core`,
 *   then importing `@callis/ucum` (which reads the file), then the first two conversions.
 * - Phases: in fresh processes, reading the XML and resolving the unit table, timed separately
 *   (from the source modules, through Node.js type stripping).
 * - Warm: the same two phases repeated in one process after warm-up, as when V8 has optimized
 *   the code. Startup only happens once per process, so this is a lower bound, not a typical case.
 *
 * Results depend on the machine and the Node.js version; they are measurements, not guarantees.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'tsdown';

const runs = Number(process.argv[2] ?? 30);
const packageDir = fileURLToPath(new URL('../', import.meta.url));
const url = (path: string): string => pathToFileURL(join(packageDir, path)).href;
const coreUrl = pathToFileURL(
  fileURLToPath(new URL('../../core/dist/index.js', import.meta.url)),
).href;

function kilobytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} kB`;
}

function stats(values: readonly number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;
  return `${at(0.5).toFixed(2)} ms (p10 ${at(0.1).toFixed(2)}, p90 ${at(0.9).toFixed(2)}, min ${(sorted[0] ?? Number.NaN).toFixed(2)}, max ${(sorted.at(-1) ?? Number.NaN).toFixed(2)})`;
}

function runNode(code: string): Record<string, number> {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout) as Record<string, number>;
}

// Sizes: the build as published, a minified build, and the packed tarball.
const files = ['dist/index.js', 'dist/essence/ucum-essence-xml.js'];
const temp = mkdtempSync(join(tmpdir(), 'callis-ucum-measure-'));
const sizeRows: string[] = [];
let packedBytes = Number.NaN;
let unpackedBytes = Number.NaN;
try {
  await build({
    config: false,
    cwd: packageDir,
    entry: ['src/index.ts', 'src/essence/ucum-essence-xml.ts'],
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    minify: true,
    dts: false,
    sourcemap: false,
    outDir: temp,
    logLevel: 'silent',
  });
  let totals = [0, 0, 0, 0];
  for (const file of files) {
    const built = readFileSync(join(packageDir, file));
    const minified = readFileSync(join(temp, file.replace(/^dist\//, '')));
    const row = [built.length, gzipSync(built).length, minified.length, gzipSync(minified).length];
    totals = totals.map((total, index) => total + (row[index] ?? 0));
    sizeRows.push(`| \`${file}\` | ${row.map(kilobytes).join(' | ')} |`);
  }
  sizeRows.push(`| **Total** | ${totals.map((value) => `**${kilobytes(value)}**`).join(' | ')} |`);
  const essence = readFileSync(join(packageDir, 'data/ucum-essence.xml'));
  sizeRows.push(
    `| \`data/ucum-essence.xml\` (for reference) | ${kilobytes(essence.length)} | ${kilobytes(gzipSync(essence).length)} | – | – |`,
  );
  execFileSync('pnpm', ['pack', '--pack-destination', temp], { cwd: packageDir, stdio: 'ignore' });
  const tarball = readdirSync(temp).find((file) => file.endsWith('.tgz'));
  if (tarball !== undefined) {
    packedBytes = statSync(join(temp, tarball)).size;
    // Extract and sum the files: the columns of `tar -tv` differ between BSD and GNU tar.
    const extracted = join(temp, 'extracted');
    mkdirSync(extracted);
    execFileSync('tar', ['-xzf', join(temp, tarball), '-C', extracted]);
    unpackedBytes = readdirSync(extracted, { recursive: true, encoding: 'utf8' })
      .map((file) => statSync(join(extracted, file)))
      .filter((entry) => entry.isFile())
      .reduce((total, entry) => total + entry.size, 0);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}

// Cold start in fresh processes.
const cold = Array.from({ length: runs }, () =>
  runNode(`
    const t0 = performance.now();
    const { Decimal } = await import(${JSON.stringify(coreUrl)});
    const t1 = performance.now();
    const { ucum } = await import(${JSON.stringify(url('dist/index.js'))});
    const t2 = performance.now();
    ucum.convert(Decimal.ONE, 'mg/dL', 'g/L');
    const t3 = performance.now();
    ucum.convert(Decimal.ONE, '[lb_av]', 'kg');
    const t4 = performance.now();
    console.log(JSON.stringify({ core: t1 - t0, ucum: t2 - t1, first: t3 - t2, second: t4 - t3 }));
  `),
);

// Phases in fresh processes, and warm repetitions in one process.
const phaseCode = (repeat: number): string => `
  const { UCUM_ESSENCE_XML } = await import(${JSON.stringify(url('dist/essence/ucum-essence-xml.js'))});
  const { readEssence } = await import(${JSON.stringify(url('src/essence/essence-reader.ts'))});
  const { buildUnitTable } = await import(${JSON.stringify(url('src/unit-table.ts'))});
  const samples = [];
  for (let i = 0; i < ${repeat}; i++) {
    const t0 = performance.now();
    const data = readEssence(UCUM_ESSENCE_XML);
    const t1 = performance.now();
    buildUnitTable(data);
    const t2 = performance.now();
    samples.push([t1 - t0, t2 - t1]);
  }
  // With repetitions, keep the second half, after V8 has optimized the code.
  const kept = samples.slice(Math.floor(samples.length / 2));
  const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  console.log(JSON.stringify({ read: median(kept.map((s) => s[0])), resolve: median(kept.map((s) => s[1])) }));
`;
const phases = Array.from({ length: runs }, () => runNode(phaseCode(1)));
const warm = Array.from({ length: Math.min(runs, 10) }, () => runNode(phaseCode(200)));

const pick = (rows: readonly Record<string, number>[], key: string): number[] =>
  rows.map((row) => row[key] ?? Number.NaN);
const cpu = cpus()[0]?.model ?? 'unknown CPU';
console.log(`## @callis/ucum size and startup

Environment: Node.js ${process.version}, ${platform()} ${release()} (${arch()}), ${cpu}, ${cpus().length} cores, ${Math.round(totalmem() / 1024 ** 3)} GB memory. ${runs} runs each.

### Size

| File | Built | Built, gzip | Minified | Minified, gzip |
| --- | ---: | ---: | ---: | ---: |
${sizeRows.join('\n')}

Packed tarball (\`pnpm pack\`, with source maps and \`data/\`): ${kilobytes(packedBytes)}; unpacked ${kilobytes(unpackedBytes)}.

### Startup

| Measurement | Median (p10, p90, min, max) |
| --- | --- |
| Cold: import \`@callis/core\` | ${stats(pick(cold, 'core'))} |
| Cold: import \`@callis/ucum\` after core (reads the UCUM file) | ${stats(pick(cold, 'ucum'))} |
| Cold: first conversion (\`mg/dL\` → \`g/L\`) | ${stats(pick(cold, 'first'))} |
| Cold: second conversion (\`[lb_av]\` → \`kg\`) | ${stats(pick(cold, 'second'))} |
| Cold phase: read the XML | ${stats(pick(phases, 'read'))} |
| Cold phase: resolve the unit table | ${stats(pick(phases, 'resolve'))} |
| Warm phase: read the XML (median of 100 per process) | ${stats(pick(warm, 'read'))} |
| Warm phase: resolve the unit table (median of 100 per process) | ${stats(pick(warm, 'resolve'))} |
`);
