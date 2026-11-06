import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyTest } from './classify.ts';
import {
  convertedFiles,
  convertSuiteFixtures,
  isUnconverted,
  UNCONVERTED_INPUTS,
  xmlInputs,
} from './fixture-conversion.ts';
import { FIXTURES_DIR, inputJsonName, loadSuite } from './fixtures.ts';
import { NumberLexeme, parseJsonKeepingNumbers } from './json-text.ts';
import { allTests, SUITE_IDS } from './suite.ts';

function readConverted(suite: string, name: string): unknown {
  return parseJsonKeepingNumbers(readFileSync(join(FIXTURES_DIR, suite, name), 'utf8'));
}

// T0023: the converted inputs are generated; `pnpm --filter @callis/conformance convert-fixtures`
// writes them, and they are never edited by hand.
describe.each(SUITE_IDS)('the converted %s fixtures', (id) => {
  const suite = loadSuite(id);
  const conversions = convertSuiteFixtures(suite);

  it.each(conversions.map((conversion) => [conversion.output, conversion.json]))(
    '%s is what convert-fixtures writes',
    (output, json) => {
      expect(readFileSync(join(FIXTURES_DIR, id, output), 'utf8')).toBe(json);
    },
  );

  it('are exactly one file for each converted XML input', () => {
    expect(convertedFiles(id)).toEqual(conversions.map((conversion) => conversion.output));
  });

  it('cover every XML input that is not listed as unconverted', () => {
    const converted = new Set(conversions.map((conversion) => conversion.input));
    for (const input of xmlInputs(suite)) {
      expect(converted.has(input) || isUnconverted(id, input), input).toBe(true);
    }
  });

  it('only leave out inputs that no phase-1 or STU test uses', () => {
    for (const test of allTests(suite)) {
      if (test.inputFile !== undefined && isUnconverted(id, test.inputFile)) {
        expect(classifyTest(test).phase, test.id).toBe('unsupported');
      }
    }
  });
});

describe('UNCONVERTED_INPUTS', () => {
  it.each(UNCONVERTED_INPUTS)('$suite/$file is an XML input of its suite', ({ suite, file }) => {
    expect(xmlInputs(loadSuite(suite))).toContain(file);
  });
});

describe('the converted fixtures keep what JSON.parse would lose', () => {
  it('keeps the exponent and its case in decimals', () => {
    const json = readConverted('r5', inputJsonName('parameters-example-decimals.xml'));
    expect(json).toMatchObject({
      parameter: [
        { name: 'exponent', valueDecimal: new NumberLexeme('9.5e2') },
        { name: 'negative-exponent', valueDecimal: new NumberLexeme('1.5e-3') },
        { name: 'negative-value', valueDecimal: new NumberLexeme('-9.5e2') },
        { name: 'upper-case-exponent', valueDecimal: new NumberLexeme('1.5E2') },
      ],
    });
  });

  it.each(SUITE_IDS)('keeps trailing zeros in %s decimals', (id) => {
    const json = readConverted(id, inputJsonName('parameters-example-types.xml'));
    expect(json).toMatchObject({
      parameter: expect.arrayContaining([
        { name: 'decimal', valueDecimal: new NumberLexeme('1.0') },
      ]),
    });
  });
});
