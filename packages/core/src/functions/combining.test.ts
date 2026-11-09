import { describe, expect, it } from 'vitest';
import { testRegistry } from '../../test/support/test-functions.ts';
import { evaluateAsync, evaluate as evaluateInternal } from '../api/compile.ts';
import { compile, evaluate } from '../index.ts';
import { ModelNode } from '../model/model-node.ts';

// The names of the HL7 `patient-example`, as synthetic data.
const patient = Object.freeze({
  resourceType: 'Patient',
  name: Object.freeze([
    Object.freeze({ use: 'official', family: 'Chalmers', given: ['Peter', 'James'] }),
    Object.freeze({ use: 'usual', given: ['Jim'] }),
    Object.freeze({ use: 'maiden', family: 'Windsor', given: ['Peter', 'James'] }),
  ]),
});

// https://hl7.org/fhirpath/N1/#unionother-collection
describe('union()', () => {
  it.each([
    ['1.combine(1).combine(2).combine(3).union(2 | 3)', [1, 2, 3]], // the spec example, A union B
    ['1.combine(1).combine(2).combine(3).union({})', [1, 2, 3]], // the spec example, A union { }
    ['(1 | 2 | 3).count() = 3', [true]], // HL7 testUnion1
    ['(1 | 2 | 2).count() = 2', [true]], // HL7 testUnion2
    ['1.union(2).union(3).count() = 3', [true]], // HL7 testUnion4
    ['1.union(2.union(3)).count() = 3', [true]], // HL7 testUnion5
    ['1.combine(1).union(2).count() = 2', [true]], // HL7 testUnion8
    ['{}.union({})', []],
    ['{}.union(1 | 2)', [1, 2]],
    ['(1 | 2).union({})', [1, 2]],
    ['1.union(1)', [1]],
  ])('%s', (expression, expected) => {
    expect(evaluate(patient, expression)).toEqual(expected);
    expect(compile(expression).evaluate(patient)).toEqual(expected);
  });

  it.each([
    ['(3 | 1).union(2 | 3 | 0)', [3, 1, 2, 0]],
    ['3.combine(1).union(1.combine(2).combine(2))', [3, 1, 2]],
    ['1.union(2.combine(2).combine(3))', [1, 2, 3]],
    ['{}.union(3.combine(1).combine(3))', [3, 1]],
  ])(
    'lists the input first, then the new items of the argument, once each: %s',
    (expression, expected) => {
      expect(evaluate(patient, expression)).toEqual(expected);
    },
  );

  // The spec calls `a.union(b)` synonymous with `a | b` (N1 §5.4.1), also where equality is
  // undetermined or the types differ.
  it.each([
    ['1', '1.0'],
    ['1', '2'],
    ['{}', '{}'],
    ['{}', '1.combine(1)'],
    ['1.combine(1)', '{}'],
    ['1.combine(1)', '2'],
    ["'a'", "'A'"],
    ["'a'", "'a'"],
    ['true', '1'],
    ['@2020', '@2020-01'],
    ['@2020-01', '@2020-01'],
    ['@2015-02-04T10:00', '@2015-02-04T10:00'],
    ['@2015-02-04T10:00', '@2015-02-04T10:00:00'],
    ['@T10:00', '@T10:00'],
    ['name.first()', 'name.first()'],
    ['name.first()', 'name.last()'],
    ['name.given', 'name.family'],
    ['name', 'name'],
  ])('is the | operator: %s union %s', (left, right) => {
    expect(evaluate(patient, `(${left}).union(${right})`)).toEqual(
      evaluate(patient, `(${left}) | (${right})`),
    );
  });

  it('does not take an undetermined comparison as equal', () => {
    // docs/spec-notes.md#intersect-exclude-and-undetermined-equality
    expect(evaluate(patient, '@2020.union(@2020-01).count()')).toEqual([2]);
    expect(evaluate(patient, '@2015-02-04T10:00.union(@2015-02-04T10:00:00).count()')).toEqual([2]);
    expect(evaluate(patient, '(@2020 | @2020-01 | @2020).count()')).toEqual([2]);
  });

  it('removes a repeated dateTime of minute precision', () => {
    expect(evaluate(patient, '@2015-02-04T10:00.union(@2015-02-04T10:00).count()')).toEqual([1]); // HL7 testUnion13
  });

  it('works inside a where() criterion with the focus of the call', () => {
    // HL7 testUnion10 and testUnion11 write `name.select(use.union(given)).count()`, which needs
    // select() (T0042). where() shows the same: the argument is read from each name.
    expect(evaluate(patient, 'name.where(use.union($this.given).count() = 3)')).toEqual([
      patient.name[0],
      patient.name[2],
    ]);
    expect(evaluate(patient, 'name.where(use.union(given).count() = 3)')).toEqual([
      patient.name[0],
      patient.name[2],
    ]);
    expect(evaluate(patient, 'name.where(use.union(given).count() = 2)')).toEqual([
      patient.name[1],
    ]);
  });

  it('keeps the first of equal complex values, and the items of the input rather than a copy', () => {
    const input = { a: [{ x: 1 }, { x: 2 }, { x: 1 }], b: [{ x: 1 }, { x: 3 }] };
    expect(evaluate(input, 'a.union(b)')).toEqual([input.a[0], input.a[1], input.b[1]]);
    expect(evaluate(input, 'a.union(b)')[0]).toBe(input.a[0]);
    expect(evaluate(input, 'b.union(a)')[0]).toBe(input.b[0]);
    expect(evaluate(input, 'b.union(a)')[1]).toBe(input.b[1]);
    expect(evaluate(input, 'a.union({})')).toEqual([input.a[0], input.a[1]]);
    expect(evaluate(input, 'a.union(a)')).toHaveLength(2);
  });

  it('preserves model-less temporal provenance, and does not give it to computed strings', () => {
    const input = { dates: ['1974-12-25', '2000-01-01'], other: ['2000-01-01', '2020-03-04'] };
    expect(evaluate(input, 'dates.union(other)')).toEqual([
      '1974-12-25',
      '2000-01-01',
      '2020-03-04',
    ]);
    expect(evaluate(input, 'dates.union(other).count()')).toEqual([3]);
    expect(evaluate(input, 'dates.first().union({}) = @1974-12-25')).toEqual([true]);
    expect(evaluate(input, 'dates.union(@2000-01-01).count()')).toEqual([2]);
    expect(evaluate({}, "'2000-01-01'.union(@2000-01-01).count()")).toEqual([2]);
  });

  it.each(['union()', 'union(1, 2)', '{}.union()', '(1 | 2).union(1, 2)'])(
    'rejects wrong arity at compile time: %s',
    (expression) => {
      expect(() => compile(expression)).toThrow(
        expect.objectContaining({ code: 'semantic/wrong-arity' }),
      );
    },
  );
});

// https://hl7.org/fhirpath/N1/#combineother-collection-collection
describe('combine()', () => {
  it.each([
    ['(1 | 2).combine(2).count() = 3', [true]], // HL7 testUnion6
    ['1.combine(1).count() = 2', [true]], // HL7 testUnion7
    ['(1 | 2).combine(2)', [1, 2, 2]],
    ['{}.combine({})', []],
    ['{}.combine(1 | 2)', [1, 2]], // an empty and a non-empty collection give the non-empty one
    ['(1 | 2).combine({})', [1, 2]],
    ['(3 | 1).combine(2 | 3)', [3, 1, 2, 3]],
    ["1.combine('a').combine(true)", [1, 'a', true]],
    ['1.combine(1).combine(1).count()', [3]],
    ['1.combine(1.0).count()', [2]],
  ])('%s', (expression, expected) => {
    expect(evaluate(patient, expression)).toEqual(expected);
    expect(compile(expression).evaluate(patient)).toEqual(expected);
  });

  it('keeps every given and family name', () => {
    const expected = ['Peter', 'James', 'Peter', 'James', 'Chalmers', 'Windsor'];
    // HL7 testCombine2 and testCombine3 (isDistinct() in testCombine1 is T0041).
    expect(evaluate(patient, "name.given.combine(name.family).exclude('Jim')")).toEqual(expected);
    expect(evaluate(patient, "name.given.combine($this.name.family).exclude('Jim')")).toEqual(
      expected,
    );
    expect(evaluate(patient, 'name.given.combine(name.family).count()')).toEqual([7]);
  });

  it('keeps duplicate objects and the identity of the items', () => {
    expect(evaluate(patient, 'name.combine(name).count()')).toEqual([6]);
    expect(evaluate(patient, 'name.first().combine(name.last())')).toEqual([
      patient.name[0],
      patient.name[2],
    ]);
    expect(evaluate(patient, 'name.last().combine(name.first())')[0]).toBe(patient.name[2]);
    expect(evaluate(patient, 'name.combine({})')[1]).toBe(patient.name[1]);
    expect(evaluate(patient, '{}.combine(name)')[2]).toBe(patient.name[2]);
  });

  it('does not change the input or the result of an earlier call', () => {
    const input = { values: [1, 2] };
    for (const expression of [
      'values.combine({})',
      '{}.combine(values)',
      'values.combine(values)',
    ]) {
      const result = evaluate(input, expression);
      result.pop();
      expect(evaluate(input, expression).length).toBeGreaterThanOrEqual(2);
    }
    expect(input.values).toEqual([1, 2]);
  });

  it('preserves model-less temporal provenance', () => {
    const input = { dates: ['1974-12-25'], more: ['2000-01-01'] };
    expect(evaluate(input, 'dates.combine(more)')).toEqual(['1974-12-25', '2000-01-01']);
    expect(evaluate(input, 'dates.combine(more).first() = @1974-12-25')).toEqual([true]);
    expect(evaluate(input, 'dates.combine(more).last() = @2000-01-01')).toEqual([true]);
  });

  // The spec's `preserveOrder` is STU (T0027); the signature takes one argument until then.
  it.each(['combine()', 'combine(1, true)', '{}.combine()', '(1 | 2).combine(1, 2)'])(
    'rejects wrong arity at compile time: %s',
    (expression) => {
      expect(() => compile(expression)).toThrow(
        expect.objectContaining({ code: 'semantic/wrong-arity' }),
      );
    },
  );
});

// ADR-0004: on the existing internal path, with a host function in the input or the argument.
describe('union() and combine() on the existing internal path', () => {
  it.each([
    ['union', '2 | 3', [0, 1, 2, 3]],
    ['combine', '2', [0, 1, 2, 2]],
  ])(
    '%s with a host function in the input and in the argument',
    async (name, argument, expected) => {
      for (const source of ['testAsync', 'testThenable']) {
        const options = { functions: testRegistry() };
        const expressions = [
          `(0 | 1 | 2).${source}().${name}(${argument})`,
          `(0 | 1 | 2).${name}((${argument}).${source}())`,
          `(0 | 1 | 2).${source}().${name}((${argument}).${source}())`,
        ];
        for (const expression of expressions) {
          expect(() => evaluateInternal({}, expression, options)).toThrow(
            expect.objectContaining({ code: 'eval/async-in-sync' }),
          );
          expect(await evaluateAsync({}, expression, options)).toEqual(expected);
        }
      }
    },
  );

  it('keeps the exact ModelNode, and combine() lists it twice', () => {
    const parent = new ModelNode({ value: {}, name: 'Patient' });
    const node = new ModelNode({ value: '1974-12-25', name: 'birthDate', parent, index: 1 });
    expect(evaluateInternal(node, '$this.union($this)', { output: 'typed' })).toEqual([node]);
    expect(evaluateInternal(node, '$this.union($this)', { output: 'typed' })[0]).toBe(node);
    const twice = evaluateInternal(node, '$this.combine($this)', { output: 'typed' });
    expect(twice).toHaveLength(2);
    expect(twice[0]).toBe(node);
    expect(twice[1]).toBe(node);
    expect(node.parent).toBe(parent);
    expect(node.index).toBe(1);
  });
});
