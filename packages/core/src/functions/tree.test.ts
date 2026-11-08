import { describe, expect, it } from 'vitest';
import { stubModel } from '../../test/support/stub-model.ts';
import { testRegistry } from '../../test/support/test-functions.ts';
import {
  type CompileOptions,
  type EvaluateOptions,
  evaluate,
  evaluateAsync,
} from '../api/compile.ts';
import { evaluate as evaluatePublic } from '../index.ts';
import { parseJson } from '../model/lossless-json.ts';
import { ModelNode } from '../model/model-node.ts';

// Synthetic data. Keys are deliberately not in FHIR definition order, so the model-less
// document order is visible.
const patient = {
  resourceType: 'Patient',
  name: [
    { given: ['Ada', 'Mina'], family: 'Lovelace' },
    { given: ['Ada'], use: 'nickname' },
  ],
  _gender: { extension: [{ url: 'https://example.org/e', valueString: 'x' }] },
  gender: 'female',
  active: true,
  telecom: [],
  contact: null,
};

function run(
  input: unknown,
  expression: string,
  options: CompileOptions & EvaluateOptions = {},
): unknown[] {
  return evaluate(input, expression, options);
}

function names(input: unknown, expression: string): string[] {
  return run(input, expression, { output: 'typed' }).map((item) =>
    item instanceof ModelNode ? item.name : `not a node: ${String(item)}`,
  );
}

// https://hl7.org/fhirpath/N1/#children-collection, docs/spec-notes.md#children-without-a-model
describe('children() without a model', () => {
  it('lists the own JSON properties in document order, flattening arrays', () => {
    expect(names(patient, 'Patient.children()')).toEqual(['name', 'name', 'gender', 'active']);
    expect(run(patient, 'Patient.name[0].children()')).toEqual(['Ada', 'Mina', 'Lovelace']);
    expect(run(patient, 'Patient.name.children()')).toEqual([
      'Ada',
      'Mina',
      'Lovelace',
      'Ada',
      'nickname',
    ]);
  });

  it('never lists resourceType or _name keys, nor empty arrays and null', () => {
    expect(run(patient, 'Patient.children().count()')).toEqual([4]);
    expect(names(patient, 'children()')).not.toContain('resourceType');
    expect(names(patient, 'children()')).not.toContain('_gender');
    // The extension object of the _gender key is not reached through the tree either.
    expect(run(patient, 'Patient.descendants().url')).toEqual([]);
  });

  it('keeps the input object identity of complex children', () => {
    expect(run(patient, 'Patient.children().first()')[0]).toBe(patient.name[0]);
  });

  it.each([
    ['{}.children()', []],
    ["'text'.children()", []],
    ['(1 | 2).children()', []],
    ['Patient.gender.children()', []],
    ['Patient.missing.children()', []],
  ])('gives empty for %s: only input objects have children', (expression, expected) => {
    expect(run(patient, expression)).toEqual(expected);
  });

  it('is available through the public API', () => {
    expect(evaluatePublic(patient, 'Patient.name[1].children()')).toEqual(['Ada', 'nickname']);
  });
});

// https://hl7.org/fhirpath/N1/#descendants-collection, docs/spec-notes.md#order-of-descendants
describe('descendants() without a model', () => {
  const tree = {
    a: { b: { c: 1 }, d: 2 },
    e: [{ f: 3 }, { f: 4 }],
    g: 5,
  };

  it('lists every node below the input in document order, without the input itself', () => {
    expect(names(tree, 'descendants()')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'e', 'f', 'g']);
    expect(run(tree, 'descendants().where($this is Integer)')).toEqual([1, 2, 3, 4, 5]);
    expect(names(tree, 'a.descendants()')).toEqual(['b', 'c', 'd']);
  });

  it('walks every input item in order', () => {
    expect(run(tree, 'e.descendants()')).toEqual([3, 4]);
    expect(run(patient, 'Patient.name.descendants()')).toEqual([
      'Ada',
      'Mina',
      'Lovelace',
      'Ada',
      'nickname',
    ]);
  });

  it('keeps equal values at different places: each node is listed once', () => {
    expect(run(patient, "Patient.descendants().where($this = 'Ada').count()")).toEqual([2]);
  });

  it('is a superset of children() and gives empty for leaves', () => {
    expect(run(tree, 'children().count()')).toEqual([4]);
    expect(run(tree, 'descendants().count()')).toEqual([9]);
    expect(run(tree, 'g.descendants()')).toEqual([]);
    expect(run(tree, '{}.descendants()')).toEqual([]);
    expect(run(tree, '1.descendants()')).toEqual([]);
  });

  it('terminates on deep input without overflowing the call stack', () => {
    const depth = 20_000;
    const deep = parseJson(`${'{"x":'.repeat(depth)}1${'}'.repeat(depth)}`);
    expect(run(deep, 'descendants().count()')).toEqual([depth]);
    expect(run(deep, 'descendants().where($this is Integer)')).toEqual([1]);
  });
});

// https://hl7.org/fhirpath/N1/#children-collection with the stub model
describe('children() and descendants() with a model', () => {
  it('lists the elements of a typed node in definition order, not in JSON order', () => {
    // The stub Patient defines active, name, gender; the JSON has name, gender, active.
    const children = run(patient, 'Patient.children()', { model: stubModel, output: 'typed' });
    expect(children.map((item) => (item instanceof ModelNode ? item.name : item))).toEqual([
      'active',
      'name',
      'name',
      'gender',
    ]);
  });

  it('folds _name extensions into the primitive, and lists them as its children', () => {
    expect(run(patient, 'Patient.gender.children().url', { model: stubModel })).toEqual([
      'https://example.org/e',
    ]);
    expect(run(patient, 'Patient.descendants().url', { model: stubModel })).toEqual([
      'https://example.org/e',
    ]);
  });
});

describe('sync and async evaluation', () => {
  it('gives the same result in async mode, also behind an async function', async () => {
    const functions = testRegistry();
    expect(await evaluateAsync(patient, 'Patient.descendants()', { functions })).toEqual(
      run(patient, 'Patient.descendants()'),
    );
    expect(
      await evaluateAsync(patient, 'Patient.name.testAsync().children()', { functions }),
    ).toEqual(['Ada', 'Mina', 'Lovelace', 'Ada', 'nickname']);
  });
});
