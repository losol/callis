import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exampleOptions, readExamples } from '../../../examples/playground/schema.ts';
import { compile, evaluate, FhirPathError } from '../src/index.ts';

const cases = readExamples(
  JSON.parse(
    readFileSync(
      new URL('../../../examples/playground/case-library.json', import.meta.url),
      'utf8',
    ),
  ),
);

describe('shared synthetic playground cases', () => {
  // https://hl7.org/fhirpath/N1/#path-selection
  // https://hl7.org/fhirpath/N1/#filtering-and-projection
  // https://hl7.org/fhirpath/N1/#existence
  // https://hl7.org/fhirpath/N1/#subsetting
  it.each(cases)('$id agrees with both public compile and evaluate', (item) => {
    for (const mode of ['compile', 'evaluate']) {
      let input: unknown;
      try {
        input = JSON.parse(item.inputText);
      } catch (error) {
        expect(error).toBeInstanceOf(SyntaxError);
        expect(item.expected).toEqual({ kind: 'error', phase: 'json' });
        continue;
      }
      try {
        const value =
          mode === 'compile'
            ? compile(item.expression).evaluate(input, exampleOptions)
            : evaluate(input, item.expression, exampleOptions);
        expect(item.expected).toEqual({ kind: 'result', value });
      } catch (error) {
        if (!(error instanceof FhirPathError)) throw error;
        expect(item.expected).toEqual({ kind: 'error', phase: 'expression', code: error.code });
      }
    }
  });

  it('keeps the original presets and clinical questions alongside two subsetting cases', () => {
    expect(cases).toHaveLength(14);
    expect(
      cases.filter((item) => item.tags.includes('clinical-data')).map((item) => item.id),
    ).toEqual(['official-given-name', 'final-observation-count', 'phone-entry']);
    expect(cases.filter((item) => item.tags.includes('subsetting')).map((item) => item.id)).toEqual(
      ['first-recorded-value', 'single-official-name'],
    );
  });
});
