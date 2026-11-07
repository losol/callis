import { describe, expect, it } from 'vitest';
import { testRegistry } from '../../test/support/test-functions.ts';
import { evaluateAsync, evaluate as evaluateInternal } from '../api/compile.ts';
import { compile, evaluate } from '../index.ts';
import { ModelNode } from '../model/model-node.ts';

// N1 §5.3.2–3: selection retains items rather than converting their values.
// https://hl7.org/fhirpath/N1/#single-collection
// https://hl7.org/fhirpath/N1/#first-collection
const patient = Object.freeze({
  resourceType: 'Patient',
  name: Object.freeze([Object.freeze({ given: ['Ada'] }), Object.freeze({ given: ['Mina'] })]),
  values: Object.freeze([3, 1, 3]),
});

describe('first and single through the public synchronous API', () => {
  it.each([
    ['{}.first()', []],
    ['{}.single()', []],
    ['missing.first()', []],
    ['missing.single()', []],
    ['values.first()', [3]],
    ['values.where($index = 1).first()', [1]],
    ['values.where($index = 1).single()', [1]],
    ['Patient.name.first().given', ['Ada']], // HL7 testFirstLast1 shape
    ['Patient.name.first().single().exists()', [true]], // HL7 testSingle1
    ['Patient.name.first().count()', [1]], // HL7 testCount3
    ['Patient.name.first().count() = 1', [true]], // HL7 testCount4
    ['false.first()', [false]],
    ['false.single()', [false]],
    ['0.first()', [0]],
    ['0.single()', [0]],
    ["''.first()", ['']],
    ["''.single()", ['']],
  ])('%s', (expression, expected) => {
    expect(evaluate(patient, expression)).toEqual(expected);
    expect(compile(expression).evaluate(patient)).toEqual(expected);
  });

  it('runs the spec Patient.name.single() example for zero, one and multiple names', () => {
    const expression = compile('Patient.name.single()');
    expect(expression.evaluate({ resourceType: 'Patient' })).toEqual([]);
    const one = { resourceType: 'Patient', name: [patient.name[0]] };
    expect(expression.evaluate(one)[0]).toBe(patient.name[0]);
    expect(() => expression.evaluate(patient)).toThrow(
      expect.objectContaining({ code: 'eval/singleton-expected' }),
    );
  });

  it('preserves object identity and input order without mutating frozen input', () => {
    expect(evaluate(patient, 'name.first()')[0]).toBe(patient.name[0]);
    expect(evaluate(patient, 'name.where($index = 1).single()')[0]).toBe(patient.name[1]);
    expect(evaluate(patient, 'values')).toEqual([3, 1, 3]);
    expect(patient.name).toHaveLength(2);
    const result = evaluate(patient, 'values.first()');
    result.push(99);
    expect(evaluate(patient, 'values.first()')).toEqual([3]);
  });

  it.each(['values.single()', 'Patient.name.single()', 'duplicates.single()'])(
    'rejects multiple items with the canonical error and call span: %s',
    (expression) => {
      expect(() => evaluate({ ...patient, duplicates: [1, 1] }, expression)).toThrow(
        expect.objectContaining({
          code: 'eval/singleton-expected',
          expression,
          span: expect.objectContaining({ start: 0, end: expression.length }),
        }),
      );
    },
  );

  it.each(['first(1)', 'first(1, 2)', 'single(1)', 'single(1, 2)', '{}.single(1)'])(
    'rejects wrong arity at compile time: %s',
    (expression) => {
      expect(() => compile(expression)).toThrow(
        expect.objectContaining({ code: 'semantic/wrong-arity' }),
      );
    },
  );

  it.each(['first()', 'where($index = 0).single()'])(
    'preserves model-less temporal provenance through %s',
    (selection) => {
      const input = { dates: ['1974-12-25', '2000-01-01'] };
      expect(evaluate(input, `dates.${selection} = @1974-12-25`)).toEqual([true]);
      expect(evaluate(input, `dates.${selection}`)).toEqual(['1974-12-25']);
      expect(evaluate({}, `'1974-12-25'.${selection} = @1974-12-25`)).toEqual([false]);
    },
  );

  it('keeps outer frames and gives subsequent filters their own indices', () => {
    const input = { groups: [{ values: [2, 4] }, { values: [4, 2] }] };
    const expression =
      'groups.where(values.first().single() = 4 and $index = 1 and $this.values[1] = 2)';
    expect(evaluate(input, expression)).toEqual([input.groups[1]]);
    expect(evaluate(patient, 'values.where($index = 1).first().where($index = 0)')).toEqual([1]);
  });
});

// ADR-0004: compatibility with the existing internal path, without a public async addition.
describe('first and single on the existing internal path', () => {
  it.each(['first()', 'single()'])('forwards the exact ModelNode through %s', (selection) => {
    const parent = new ModelNode({ value: {}, name: 'Patient' });
    const node = new ModelNode({ value: '1974-12-25', name: 'birthDate', parent, index: 1 });
    const result = evaluateInternal(node, `$this.${selection}`, { output: 'typed' });
    expect(result[0]).toBe(node);
    expect(node.parent).toBe(parent);
    expect(node.index).toBe(1);
  });

  it.each(['testAsync', 'testThenable'])(
    'selects after %s and retains nested frames across suspension',
    async (source) => {
      const options = { functions: testRegistry() };
      const input = { groups: [{ values: [2, 4] }, { values: [4, 2] }] };
      const expression = `groups.where(values.${source}().first().single() = 4 and $index = 1)`;
      expect(() => evaluateInternal(input, expression, options)).toThrow(
        expect.objectContaining({ code: 'eval/async-in-sync' }),
      );
      expect(await evaluateAsync(input, expression, options)).toEqual([input.groups[1]]);
      expect(await evaluateAsync({}, `{}.${source}().single()`, options)).toEqual([]);
      await expect(
        evaluateAsync(patient, `values.${source}().single()`, options),
      ).rejects.toMatchObject({
        code: 'eval/singleton-expected',
      });
    },
  );
});
