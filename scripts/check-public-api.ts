/** Packs the built core and checks a clean ESM/TypeScript consumer without workspace aliases. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'callis-public-api-'));
try {
  for (const name of ['core', 'ucum']) {
    execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', temporary], {
      cwd: join(root, 'packages', name),
      stdio: 'pipe',
    });
    const archive = readdirSync(temporary).find(
      (file) => file.startsWith(`callis-${name}-`) && file.endsWith('.tgz'),
    );
    if (archive === undefined) throw new Error(`npm pack produced no ${name} archive`);
    const installed = join(temporary, 'node_modules/@callis', name);
    mkdirSync(installed, { recursive: true });
    execFileSync('tar', [
      '-xzf',
      join(temporary, archive),
      '--strip-components=1',
      '-C',
      installed,
    ]);
  }
  writeFileSync(join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  writeFileSync(
    join(temporary, 'consumer.mts'),
    `
import assert from 'node:assert/strict';
import * as core from '@callis/core';
import { ucum } from '@callis/ucum';
assert.deepEqual(Object.keys(core).sort(), [
  'Decimal', 'MAX_DECIMAL_DIGITS', 'minimalUnitSystem', 'compile', 'evaluate', 'parseJson', 'JsonNumber',
  'FhirPathError', 'FhirPathSyntaxError', 'FhirPathSemanticError', 'FhirPathEvaluationError'
].sort());
const lossless = core.parseJson('{"rows": [{"value": 1.50}]}');
assert.deepEqual(core.evaluate(lossless, 'rows.value', { decimalOutput: 'string' }), ['1.50']);
assert.deepEqual(core.evaluate(lossless, 'rows.value'), [1.5]);
assert.ok(lossless.rows[0].value instanceof core.JsonNumber);
assert.throws(() => core.parseJson('{'), error => error.code === 'eval/invalid-json');
assert.deepEqual(core.evaluate({ name: [{ given: ['Ada'] }] }, 'name.given'), ['Ada']);
assert.deepEqual(core.evaluate({ rows: [{ value: 1 }, { value: 2 }] }, 'rows.where(value > 1).value'), [2]);
assert.deepEqual(core.compile('rows.where($index = 0).value').evaluate({ rows: [{ value: 3 }, { value: 4 }] }), [3]);
assert.throws(() => core.evaluate({ rows: [1] }, 'rows.where(true | false)'), error => error.code === 'eval/singleton-expected');
const compiled = core.compile('%value', { units: core.minimalUnitSystem });
assert.deepEqual(compiled.evaluate(null, {
  variables: { value: core.Decimal.parse('9007199254740993.1200') }, decimalOutput: 'string'
}), ['9007199254740993.1200']);
assert.equal(JSON.stringify(core.evaluate(null, "1.200 'mg'", { decimalOutput: 'string' })),
  '[{"value":"1.200","unit":"mg","system":"http://unitsofmeasure.org","code":"mg"}]');
assert.deepEqual(core.evaluate(null, '{}.first()'), []);
assert.deepEqual(core.evaluate(null, '{}.single()'), []);
const selected = { rows: [{ value: 3 }, { value: 1 }] };
assert.equal(core.evaluate(selected, 'rows.first()')[0], selected.rows[0]);
assert.equal(core.compile('rows.where(value = 1).single()').evaluate(selected)[0], selected.rows[1]);
assert.throws(() => core.evaluate(selected, 'rows.single()'), error => error.code === 'eval/singleton-expected');
assert.throws(() => core.compile('first(1)'), error => error.code === 'semantic/wrong-arity');
assert.deepEqual(core.evaluate(null, '{}.count()'), [0]);
assert.deepEqual(core.evaluate(null, '{}.exists()'), [false]);
const rows = { rows: [{ flag: false }, { flag: true }, { flag: [true, false] }] };
assert.deepEqual(core.compile('rows.exists(flag)').evaluate(rows), [true]);
assert.deepEqual(core.evaluate({ rows: [{ value: 1 }, { value: 2 }] }, 'rows.where(value > 1).count()'), [1]);
assert.deepEqual(core.evaluate(null, "iif(true, 'lazy', %missing)"), ['lazy']);
assert.deepEqual(core.evaluate(null, '1.0.toString()'), ['1.0']);
assert.deepEqual(core.evaluate(null, "'2015-02-04T14:34'.toDateTime()"), ['2015-02-04T14:34']);
assert.deepEqual(core.evaluate(null, "'1.a'.convertsToDecimal()"), [false]);
assert.deepEqual(core.evaluate(null, "'4 days'.toQuantity('h')", { units: ucum }),
  [{ value: 96, unit: 'h', system: 'http://unitsofmeasure.org', code: 'h' }]);
assert.throws(() => core.evaluate(null, '(1 | 2).toInteger()'), error => error.code === 'eval/singleton-expected');
assert.deepEqual(core.evaluate({ name: 'Ada' }, 'name.upper()'), ['ADA']);
assert.deepEqual(core.evaluate(null, "'a🔥b'.length()"), [3]);
assert.throws(() => core.evaluate(null, "'a'.matches('(')"), error => error.code === 'eval/invalid-argument');
assert.throws(() => core.compile('intentionallyMissingFunction()'), core.FhirPathSemanticError);
assert.throws(() => core.evaluate(null, '%missing'), core.FhirPathEvaluationError);
assert.equal(core.Decimal.name, 'Decimal');
const converted = ucum.convert(core.Decimal.ONE, 'kg', 'g');
assert.ok(converted instanceof core.Decimal);
assert.equal(converted.toString(), '1000');
for (const [expression, ErrorClass] of [
  ['Patient.', core.FhirPathSyntaxError],
  ['intentionallyMissingFunction()', core.FhirPathSemanticError],
  ['%missing', core.FhirPathEvaluationError],
]) {
  assert.throws(() => core.evaluate(null, expression), (error) => {
    assert.ok(error instanceof core.FhirPathError);
    assert.ok(error instanceof ErrorClass);
    assert.equal(error.name, ErrorClass.name);
    assert.equal(error.expression, expression);
    assert.equal(error.span.line, 1);
    assert.ok(error.format().includes(error.code));
    return true;
  });
}
assert.throws(() => core.compile(42), (error) => {
  assert.ok(error.stack.includes('src/api/public-api.ts'));
  return error.code === 'eval/invalid-argument';
});
${
  process.argv.includes('--operators')
    ? `
assert.deepEqual(core.evaluate(null, '0.1 + 0.2', { decimalOutput: 'string' }), ['0.3']);
assert.deepEqual(core.evaluate(null, "1 'kg' = 1000 'g'", { units: ucum }), [true]);
assert.deepEqual(core.evaluate(null, '1 / 0'), []);
assert.deepEqual(core.evaluate(null, '1 | 1 | 2'), [1, 2]);
const temporal = core.compile('@2024-01-01T00:00 = @2024-01-01T00:00Z');
assert.deepEqual(temporal.evaluate(null), [true]);
assert.deepEqual(temporal.evaluate(null, { timezoneOffset: 60 }), [false]);
assert.deepEqual(temporal.evaluate(null), [true]);
let calls = 0;
const units = { ...core.minimalUnitSystem, compare() {
  assert.equal(this, units); calls++; return 0;
} };
const expr = "1 'custom-a' = 2 'custom-b'";
assert.deepEqual(core.evaluate(null, expr, { units }), [true]);
assert.deepEqual(core.compile(expr, { units }).evaluate(null), [true]);
assert.ok(calls > 0);
for (const [method, expression] of [
  ['compare', expr], ['convert', expr],
  ['multiply', "1 'custom-a' * 2 'custom-b'"],
  ['divide', "1 'custom-a' / 2 'custom-b'"],
]) {
  for (const returned of [Promise.reject(new Error('rejected provider')), { then(resolve) { resolve(0); } }]) {
    const asynchronous = { ...core.minimalUnitSystem, [method]() { return returned; } };
    for (const run of [() => core.evaluate(null, expression, { units: asynchronous }),
      () => core.compile(expression, { units: asynchronous }).evaluate(null)]) {
      assert.throws(run, (error) => error instanceof core.FhirPathEvaluationError && error.code === 'eval/async-in-sync');
    }
  }
}
const failure = new Error('provider failure');
assert.throws(() => core.evaluate(null, expr, { units: { ...core.minimalUnitSystem, compare() { throw failure; } } }), error => error === failure);
`
    : ''
}
`,
  );
  execFileSync(process.execPath, ['--enable-source-maps', join(temporary, 'consumer.mts')], {
    stdio: 'inherit',
  });
  writeFileSync(
    join(temporary, 'types.mts'),
    `
import { compile, evaluate, Decimal, minimalUnitSystem, parseJson, JsonNumber,
  FhirPathError, FhirPathEvaluationError,
  type CompileOptions, type EvaluateOptions, type CompiledExpression, type JsonValue,
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
const lossless: JsonValue = parseJson('{"value": 1.50}');
const number: JsonNumber | undefined = lossless instanceof JsonNumber ? lossless : undefined;
const text: string | undefined = number?.text;
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
  console.log(
    'Packed core/UCUM ESM, exact Decimal identity, diagnostics and declaration consumer passed.',
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
