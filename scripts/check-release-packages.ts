/** T0037/T0040: install actual tarballs and exercise their contracts in Node and Vite. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'callis-release-'));
const names = ['core', 'ucum', 'fhir-r4', 'fhir-r5', 'fhir-r6'];
const success = `${names.length} packed contracts passed`;
const r6Source = 'hl7.fhir.r6.core@6.0.0-snapshot1';
const r6Sha256 = 'c67aad1c83851aa7702f10a210f9e0e2c9fb0a54dcd43fd0826296dc6a175f59';
const run = (command: string, args: string[], cwd: string): string =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
try {
  let source = root;
  if (process.argv.includes('--stable')) {
    // Never version the checkout. Reuse only the pinned tooling from its node_modules.
    source = join(temporary, 'candidate');
    mkdirSync(source);
    for (const path of ['package.json', 'pnpm-workspace.yaml', '.changeset', 'packages']) {
      cpSync(join(root, path), join(source, path), {
        recursive: true,
        filter: (path) => !path.split('/').includes('node_modules'),
      });
    }
    symlinkSync(join(root, 'node_modules'), join(source, 'node_modules'), 'dir');
    const cli = join(root, 'node_modules/@changesets/cli/bin.js');
    const state = join(source, '.changeset/pre.json');
    if (existsSync(state) && JSON.parse(readFileSync(state, 'utf8')).mode === 'pre') {
      run(process.execPath, [cli, 'pre', 'exit'], source);
    }
    run(process.execPath, [cli, 'version'], source);
    assert.equal(existsSync(state), false, 'stable versioning must remove prerelease state');
  }
  const consumer = join(temporary, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const archives: string[] = [];
  let r6Inventory: unknown;
  for (const name of names) {
    const packed = JSON.parse(
      run(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary],
        join(source, 'packages', name),
      ),
    )[0];
    const files: string[] = packed.files.map((file: { path: string }) => file.path);
    for (const required of ['README.md', 'package.json', 'dist/index.js', 'dist/index.d.ts']) {
      assert.ok(files.includes(required), `${name}: missing ${required}`);
    }
    const license = name === 'ucum' ? 'LICENSE.md' : 'LICENSE';
    assert.ok(files.includes(license), `${name}: missing full license`);
    const archive = join(temporary, packed.filename);
    const text = run('tar', ['-xOf', archive, `package/${license}`], root);
    assert.ok(text.includes('Permission is hereby granted, free of charge'));
    if (name !== 'ucum') assert.equal(text, readFileSync(join(root, 'LICENSE'), 'utf8'));
    const manifest = JSON.parse(run('tar', ['-xOf', archive, 'package/package.json'], root));
    assert.equal(manifest.type, 'module');
    assert.deepEqual(manifest.dependencies ?? {}, {});
    assert.deepEqual(manifest.exports, {
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './package.json': './package.json',
    });
    for (const path of name === 'ucum'
      ? ['SOURCE.md', 'UCUM-LICENSE.md', 'data/ucum-essence.xml', 'data/source.json']
      : name.startsWith('fhir-')
        ? ['SOURCE.md', ...(name === 'fhir-r6' ? ['inventory.json'] : [])]
        : []) {
      assert.ok(files.includes(path), `${name}: missing ${path}`);
      assert.equal(
        run('tar', ['-xOf', archive, `package/${path}`], root),
        readFileSync(join(root, 'packages', name, path), 'utf8'),
      );
    }
    if (name === 'fhir-r6') {
      const notice = run('tar', ['-xOf', archive, 'package/SOURCE.md'], root);
      for (const required of [r6Source, r6Sha256, 'CC0-1.0', 'HL7', 'snapshot']) {
        assert.ok(notice.includes(required), `R6 source notice: missing ${required}`);
      }
      r6Inventory = JSON.parse(run('tar', ['-xOf', archive, 'package/inventory.json'], root));
    }
    if (process.argv.includes('--stable')) {
      assert.ok(!manifest.version.includes('-'), `${name}: still a prerelease`);
      assert.ok(files.includes('CHANGELOG.md'));
      const changelog = run('tar', ['-xOf', archive, 'package/CHANGELOG.md'], root);
      assert.ok(changelog.includes(`## ${manifest.version}`));
    }
    console.log(
      JSON.stringify({
        package: manifest.name,
        version: manifest.version,
        peers: manifest.peerDependencies ?? {},
        bytes: packed.size,
        unpackedBytes: packed.unpackedSize,
        integrity: packed.integrity,
      }),
    );
    archives.push(archive);
  }
  // npm resolves the peer from the same local set; no workspace aliases or registry fallback.
  run(
    'npm',
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--strict-peer-deps',
      '--no-audit',
      '--no-fund',
      ...archives,
    ],
    consumer,
  );
  const contract = `
import { compile, evaluate, Decimal, FhirPathError, FhirPathSemanticError } from '@callis/core';
import { ucum } from '@callis/ucum';
import { r4 } from '@callis/fhir-r4';
import { r5 } from '@callis/fhir-r5';
import { r6 } from '@callis/fhir-r6';
function equal(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(JSON.stringify({actual, expected}));
}
export function check() {
  equal(evaluate({resourceType:'Patient',name:[{given:['Ada','Mina']}]}, 'Patient.name.given'), ['Ada','Mina']);
  equal(compile('name[0]').evaluate({name:['Ada']}), ['Ada']);
  equal(evaluate(null, '{}'), []);
  equal(evaluate(null, '0.1 + 0.2', {decimalOutput:'string'}), ['0.3']);
  equal(evaluate(null, "1 'kg' = 1000 'g'", {units:ucum}), [true]);
  equal(evaluate(null, "1.200 'mg'", {decimalOutput:'string'}), [{value:'1.200',unit:'mg',system:'http://unitsofmeasure.org',code:'mg'}]);
  const value = ucum.convert(Decimal.ONE, 'kg', 'g');
  if (!(value instanceof Decimal)) throw new Error('duplicated Decimal identity');
  equal(value.toString(), '1000');
  let rejected = false;
  try { compile('where(true)'); } catch (error) {
    if (!(error instanceof FhirPathError) || !(error instanceof FhirPathSemanticError)) throw error;
    equal(error.code, 'semantic/unknown-function'); rejected = true;
  }
  if (!rejected) throw new Error('unsupported function silently accepted');
  for (const [model, version] of [[r4,'4.0.1'],[r5,'5.0.0'],[r6,'6.0.0-snapshot1']]) {
    equal(model.namespace, 'FHIR'); equal(model.version, version);
    const patient = model.getType('Patient');
    if (!patient || !Object.isFrozen(patient)) throw new Error('missing immutable model metadata');
    const choice = model.getElement(patient, 'deceased');
    equal(choice?.isChoice, true); equal(choice?.typeNames, ['boolean','dateTime']);
    if (!Object.isFrozen(choice) || !Object.isFrozen(choice.typeNames)) throw new Error('mutable choice metadata');
  }
  // Exact pinned snapshots, not assumptions about final R6:
  // https://hl7.org/fhir/6.0.0-snapshot1/observation-definitions.html#Observation.value_x_
  // https://hl7.org/fhir/6.0.0-snapshot1/observation-definitions.html#Observation.bodyStructure
  // https://hl7.org/fhir/6.0.0-snapshot1/devicealert-definitions.html#DeviceAlert
  // https://hl7.org/fhir/6.0.0-snapshot1/datatypes-definitions.html#RelativeTime.offset_x_
  function type(model, name) {
    const found = model.getType(name);
    if (!found) throw new Error('missing packed type: ' + name);
    return found;
  }
  function element(model, name, field) {
    const found = model.getElement(type(model, name), field);
    if (!found) throw new Error('missing packed element: ' + name + '.' + field);
    return found;
  }
  const inventory = ${JSON.stringify(r6Inventory)};
  equal(inventory.source, '${r6Source}');
  equal(inventory.total, 683);
  equal(Object.keys(inventory.types).sort(), ['backbone','complex','primitive','resource']);
  let count = 0;
  for (const [kind, expected] of [['resource',124],['complex',51],['primitive',21],['backbone',487]]) {
    const names = inventory.types[kind];
    equal(names.length, expected); equal(new Set(names).size, expected);
    equal(names, [...names].sort()); count += names.length;
    for (const name of names) {
      const found = type(r6, name);
      equal(found.kind, kind);
      if (!Object.isFrozen(found) || !Object.isFrozen(r6.getElements(found))) throw new Error('mutable packed metadata');
      for (const field of r6.getElements(found)) {
        if (!Object.isFrozen(field) || !Object.isFrozen(field.typeNames)) throw new Error('mutable packed element');
        for (const allowed of field.typeNames) type(r6, allowed);
      }
    }
  }
  equal(count, inventory.total);
  if (!Object.isFrozen(r6)) throw new Error('mutable packed provider');
  equal(r6.getRootType({resourceType:'DeviceAlert'}), type(r6,'DeviceAlert'));
  equal(r6.getRootType(Object.create({resourceType:'DeviceAlert'})), undefined);
  for (const model of [r4,r5]) equal(model.getType('DeviceAlert'), undefined);
  equal(element(r6,'Observation','organizer').typeNames, ['boolean']);
  equal(element(r6,'Observation','bodyStructure').typeNames, ['CodeableReference']);
  equal(element(r6,'Observation','bodyStructure').isArray, true);
  equal(element(r5,'Observation','bodyStructure').typeNames, ['Reference']);
  equal(element(r5,'Observation','bodyStructure').isArray, false);
  equal(element(r6,'Observation','value').typeNames, [
    'Quantity','CodeableConcept','string','boolean','integer','Range','Ratio',
    'SampledData','time','dateTime','Period','Attachment'
  ]);
  equal(element(r6,'Observation','value').isChoice, true);
  equal(element(r5,'Observation','value').typeNames.includes('Reference'), true);
  equal(element(r6,'RelativeTime','offset').typeNames, ['Duration','Range']);
  equal(element(r6,'RelativeTime','offset').isChoice, true);
  equal(element(r6,'Questionnaire.item','item').typeNames, ['Questionnaire.item']);
  equal(r6.getSystemType(type(r6,'integer64')), 'Long');
  equal(r6.getSystemType(type(r6,'Age')), 'Quantity');
  let rejectedModel = false;
  try { compile('DeviceAlert', {model:r6}); } catch (error) {
    if (!(error instanceof FhirPathError)) throw error;
    equal(error.code, 'eval/invalid-argument'); rejectedModel = true;
  }
  if (!rejectedModel) throw new Error('provider import silently enabled unsupported public model option');
  return '${success}';
}
`;
  writeFileSync(join(consumer, 'contract.mjs'), contract);
  writeFileSync(
    join(consumer, 'node.mjs'),
    "import { check } from './contract.mjs'; console.log(check());",
  );
  run(process.execPath, ['--enable-source-maps', 'node.mjs'], consumer);
  writeFileSync(
    join(consumer, 'types.mts'),
    `
import { compile, evaluate, type ModelProvider, type UnitSystem } from '@callis/core';
import { ucum } from '@callis/ucum';
import { r4 } from '@callis/fhir-r4';
import { r5 } from '@callis/fhir-r5';
import { r6 } from '@callis/fhir-r6';
const models: readonly ModelProvider[] = [r4, r5, r6];
const units: UnitSystem = ucum;
const result: unknown[] = evaluate(null, '1', {units, decimalOutput:'string'});
// @ts-expect-error provider metadata does not imply public model-aware evaluation
compile('Patient', {model:r4});
// @ts-expect-error R6 metadata also does not enable public model-aware evaluation
compile('DeviceAlert', {model:r6});
`,
  );
  run(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--module',
      'nodenext',
      '--target',
      'es2022',
      'types.mts',
    ],
    consumer,
  );
  writeFileSync(
    join(consumer, 'index.html'),
    '<!doctype html><title>Packed release smoke</title><p id="result">Loading</p><script type="module" src="/browser.mjs"></script>',
  );
  writeFileSync(
    join(consumer, 'browser.mjs'),
    "import {check} from './contract.mjs'; document.querySelector('#result').textContent = check();",
  );
  await build({ root: consumer, configFile: false, logLevel: 'warn' });
  const server = await preview({
    root: consumer,
    configFile: false,
    preview: { host: '127.0.0.1', port: 0 },
  });
  try {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      const url = server.resolvedUrls?.local[0];
      assert.ok(url);
      await page.goto(url);
      await page.locator('#result').filter({ hasText: success }).waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
  console.log(
    `${names.length} tarballs: offline strict-peer install, full licenses/notices, Node ESM, TypeScript and production Vite/Chromium PASS.`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
