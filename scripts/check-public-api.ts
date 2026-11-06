/** Packs the built core and checks a clean ESM/TypeScript consumer without workspace aliases. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'callis-public-api-'));
try {
  execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', temporary], {
    cwd: join(root, 'packages/core'),
    stdio: 'pipe',
  });
  const archive = readdirSync(temporary).find((name) => name.endsWith('.tgz'));
  if (archive === undefined) throw new Error('npm pack produced no archive');
  const installed = join(temporary, 'node_modules/@callis/core');
  mkdirSync(installed, { recursive: true });
  execFileSync('tar', ['-xzf', join(temporary, archive), '--strip-components=1', '-C', installed]);
  writeFileSync(join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  writeFileSync(
    join(temporary, 'consumer.mts'),
    `
import assert from 'node:assert/strict';
import * as core from '@callis/core';
assert.deepEqual(Object.keys(core).sort(), [
  'Decimal', 'MAX_DECIMAL_DIGITS', 'minimalUnitSystem', 'compile', 'evaluate',
  'FhirPathError', 'FhirPathSyntaxError', 'FhirPathSemanticError', 'FhirPathEvaluationError'
].sort());
assert.deepEqual(core.evaluate({ name: [{ given: ['Ada'] }] }, 'name.given'), ['Ada']);
const compiled = core.compile('%value', { units: core.minimalUnitSystem });
assert.deepEqual(compiled.evaluate(null, {
  variables: { value: core.Decimal.parse('9007199254740993.1200') }, decimalOutput: 'string'
}), ['9007199254740993.1200']);
assert.equal(JSON.stringify(core.evaluate(null, "1.200 'mg'", { decimalOutput: 'string' })),
  '[{"value":"1.200","unit":"mg","system":"http://unitsofmeasure.org","code":"mg"}]');
assert.throws(() => core.compile('where(true)'), core.FhirPathSemanticError);
assert.throws(() => core.evaluate(null, '%missing'), core.FhirPathEvaluationError);
`,
  );
  execFileSync(process.execPath, [join(temporary, 'consumer.mts')], { stdio: 'inherit' });
  writeFileSync(
    join(temporary, 'types.mts'),
    `
import { compile, evaluate, Decimal, minimalUnitSystem,
  FhirPathError, FhirPathEvaluationError,
  type CompileOptions, type EvaluateOptions, type CompiledExpression,
  type PlainQuantity, type UnitSystem, type ModelProvider, type SourceSpan,
  type Diagnostic, type ErrorCode, type FhirPathErrorOptions,
} from '@callis/core';
const units: UnitSystem = minimalUnitSystem;
const options: CompileOptions = { units };
const run: CompiledExpression = compile('1', options);
const output: unknown[] = run.evaluate(null, { variables: { value: Decimal.ONE }, timezoneOffset: 60, decimalOutput: 'string' });
const oneOff: unknown[] = evaluate(null, '1', options);
const quantity: PlainQuantity = { value: '1.20', unit: 'mg' };
const error: FhirPathError = new FhirPathEvaluationError('eval/invalid-argument', 'bad option');
const code: ErrorCode = error.code;
const span: SourceSpan | undefined = error.span;
// @ts-expect-error AST is deferred
run.ast;
// @ts-expect-error async is deferred
run.evaluateAsync(null);
// @ts-expect-error model option is deferred
compile('1', { model: {} });
// @ts-expect-error typed output is deferred
evaluate(null, '1', { output: 'typed' });
// @ts-expect-error registries are deferred
compile('1', { functions: {} });
// @ts-expect-error no public parser yet
import { parse } from '@callis/core';
// @ts-expect-error no public runtime wrappers
import { ModelNode } from '@callis/core';
type NoModel = 'model' extends keyof CompileOptions ? never : true;
type NoOutput = 'output' extends keyof EvaluateOptions ? never : true;
const noModel: NoModel = true;
const noOutput: NoOutput = true;
`,
  );
  execFileSync(
    process.execPath,
    [
      resolve(root, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--module',
      'nodenext',
      '--target',
      'es2022',
      join(temporary, 'types.mts'),
    ],
    {
      cwd: temporary,
      stdio: 'inherit',
    },
  );
  console.log('Packed @callis/core ESM and declaration consumer passed.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
