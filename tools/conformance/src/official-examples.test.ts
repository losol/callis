import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { xmlInputs } from './fixture-conversion.ts';
import { FIXTURES_DIR, inputJsonName, loadSuite } from './fixtures.ts';
import { NumberLexeme, parseJsonKeepingNumbers } from './json-text.ts';
import {
  diffJson,
  OFFICIAL_EXAMPLES,
  OFFICIAL_EXAMPLES_DIR,
  officialExamplePath,
} from './official-examples.ts';

interface ExampleSource {
  readonly files: Readonly<Record<string, { readonly package: string; readonly sha256: string }>>;
}

describe('vendored official examples', () => {
  const source: ExampleSource = JSON.parse(
    readFileSync(join(OFFICIAL_EXAMPLES_DIR, 'source.json'), 'utf8'),
  );

  it('are the files OFFICIAL_EXAMPLES names', () => {
    const named = OFFICIAL_EXAMPLES.map((example) => `${example.suite}/${example.official}`);
    expect(Object.keys(source.files).sort()).toEqual([...named].sort());
  });

  it.each(Object.entries(source.files))('%s is unchanged', (path, file) => {
    const content = readFileSync(join(OFFICIAL_EXAMPLES_DIR, path));
    expect(createHash('sha256').update(content).digest('hex')).toBe(file.sha256);
  });
});

// T0023 acceptance: the converted fixtures differ from the official JSON examples only where
// OFFICIAL_EXAMPLES says why.
describe.each(OFFICIAL_EXAMPLES)('$suite/$fixture', (example) => {
  it('is an XML input of its suite', () => {
    expect(xmlInputs(loadSuite(example.suite))).toContain(example.fixture);
  });

  it('differs from its official JSON example only where documented', () => {
    const converted = parseJsonKeepingNumbers(
      readFileSync(join(FIXTURES_DIR, example.suite, inputJsonName(example.fixture)), 'utf8'),
    );
    const official = parseJsonKeepingNumbers(readFileSync(officialExamplePath(example), 'utf8'));
    const documented = example.differences.flatMap((difference) => difference.paths);
    expect(diffJson(converted, official).sort()).toEqual([...documented].sort());
  });
});

describe('diffJson', () => {
  const n = (text: string) => new NumberLexeme(text);

  it('finds nothing in equal values', () => {
    const value = () => ({ a: [n('1.50'), 'x', true, null], b: { c: n('2') } });
    expect(diffJson(value(), value())).toEqual([]);
  });

  it('compares numbers by their text', () => {
    expect(diffJson({ v: n('1.50') }, { v: n('1.5') })).toEqual(['v']);
    expect(diffJson({ v: n('1') }, { v: '1' })).toEqual(['v']);
  });

  it('names properties and items that only one side has', () => {
    expect(diffJson({ a: 1, b: [1] }, { c: 1, b: [1, 2] })).toEqual(['a', 'b[1]', 'c']);
  });

  it('names nested values that differ', () => {
    expect(diffJson({ a: [{ b: 'x' }] }, { a: [{ b: 'y' }] })).toEqual(['a[0].b']);
    expect(diffJson({ a: 'x' }, { a: { b: 'x' } })).toEqual(['a']);
  });

  it('notices shared properties in a different order', () => {
    expect(diffJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual(['(order)']);
    expect(diffJson({ x: { a: 1, b: 2 } }, { x: { b: 2, a: 1 } })).toEqual(['x (order)']);
  });
});
