import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES_DIR, inputJsonName, loadSuite, readFixtureSource } from './fixtures.ts';
import { allTests, SUITE_IDS } from './suite.ts';

// The vendored suite must stay exactly as upstream ships it (fixtures/SOURCE.md).
describe('vendored fixtures', () => {
  const source = readFixtureSource();

  it('are pinned to a commit', () => {
    expect(source.repository).toBe('FHIR/fhir-test-cases');
    expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it.each(Object.entries(source.files))('%s is unchanged', (path, file) => {
    const content = readFileSync(join(FIXTURES_DIR, path));
    expect(createHash('sha256').update(content).digest('hex')).toBe(file.sha256);
  });

  it.each(SUITE_IDS)('include every input file the %s suite references', (id) => {
    const inputs = new Set(allTests(loadSuite(id)).flatMap((test) => test.inputFile ?? []));
    for (const input of inputs) {
      expect(source.files, input).toHaveProperty([`${id}/${input}`]);
    }
  });

  it.each(SUITE_IDS)('give unique test IDs in the %s suite', (id) => {
    const ids = allTests(loadSuite(id)).map((test) => test.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // T0023 writes the JSON for `name.xml` to `name.json`, which must not be an upstream file.
  it('leave room for the converted JSON of every XML input', () => {
    for (const path of Object.keys(source.files)) {
      if (path.endsWith('.xml')) {
        expect(Object.hasOwn(source.files, inputJsonName(path)), path).toBe(false);
      }
    }
  });
});

describe('inputJsonName', () => {
  it('maps XML inputs to the converted JSON next to them, and keeps JSON inputs', () => {
    expect(inputJsonName('patient-example.xml')).toBe('patient-example.json');
    expect(inputJsonName('patient-name-extensions.json')).toBe('patient-name-extensions.json');
  });
});
