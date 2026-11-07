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

  it('keeps nine original presets and exactly three clinical-data questions', () => {
    expect(cases).toHaveLength(12);
    expect(
      cases.filter((item) => item.tags.includes('clinical-data')).map((item) => item.id),
    ).toEqual(['official-given-name', 'final-observation-count', 'phone-entry']);
  });
});
