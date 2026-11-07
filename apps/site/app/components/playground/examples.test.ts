import { evaluate } from '@callis/core';
import { describe, expect, it } from 'vitest';
import {
  exampleOptions,
  readExamples,
  searchExamples,
} from '../../../../../examples/playground/schema';
import { loadExamples } from './examples';

const examples = await loadExamples();
const first = examples[0];
if (!first) throw new Error('Missing default example.');

describe('playground library loading and search', () => {
  // https://hl7.org/fhirpath/N1/#path-selection
  it.each(examples)('$title runs from the same lazy data used in the browser', (item) => {
    expect({
      kind: 'result',
      value: evaluate(JSON.parse(item.inputText), item.expression, exampleOptions),
    }).toEqual(item.expected);
  });

  it('searches titles, questions and tags locally, including empty results', () => {
    expect(searchExamples(examples, ' CLINICAL-data observations ').map((item) => item.id)).toEqual(
      ['final-observation-count'],
    );
    expect(searchExamples(examples, 'phone').map((item) => item.id)).toEqual(['phone-entry']);
    expect(searchExamples(examples, 'not-a-case')).toEqual([]);
    expect(searchExamples(examples, '   ')).toEqual(examples);
  });

  it('rejects ambiguous IDs, missing narrative, unsafe provenance and unsupported requirements', () => {
    expect(() => readExamples({ schemaVersion: 1, cases: [first, first] })).toThrow('Duplicate');
    for (const bad of [
      { ...first, question: '' },
      { ...first, id: 'invalid ID' },
      { ...first, source: { ...first.source, path: '../../secret' } },
      { ...first, requires: { functions: ['resolve'], model: 'none' } },
      { ...first, expected: { kind: 'error', phase: 'expression', code: 'message text' } },
      { ...first, expected: { kind: 'result', value: [NaN] } },
    ])
      expect(() => readExamples({ schemaVersion: 1, cases: [bad] })).toThrow('Invalid');
    expect(() => readExamples({ schemaVersion: 2, cases: [first] })).toThrow('Invalid');
  });
});
