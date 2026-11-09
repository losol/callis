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

// The names of the HL7 `patient-example`, as synthetic data: three names, five given names.
const names = Object.freeze({
  resourceType: 'Patient',
  name: Object.freeze([
    Object.freeze({ use: 'official', family: 'Chalmers', given: ['Peter', 'James'] }),
    Object.freeze({ use: 'usual', given: ['Jim'] }),
    Object.freeze({ use: 'maiden', family: 'Windsor', given: ['Peter', 'James'] }),
  ]),
});

// https://hl7.org/fhirpath/N1/#last-collection
// https://hl7.org/fhirpath/N1/#tail-collection
describe('last() and tail()', () => {
  it.each([
    ['{}.last()', []],
    ['(0 | 1 | 2).last()', [2]],
    ['1.last()', [1]],
    ['1.combine(1).last()', [1]],
    ['(3 | 1 | 3 | 2).last()', [2]],
    ["Patient.name.last().given = ('Peter' | 'James')", [true]], // HL7 testFirstLast2
    ['{}.tail()', []],
    ['1.tail()', []],
    ['(0 | 1 | 2).tail() = (1 | 2)', [true]], // HL7 testTail1
    ['(0 | 1 | 2).tail()', [1, 2]],
    ['1.combine(1).combine(1).tail().count()', [2]],
    ["Patient.name.tail().given = ('Jim' | 'Peter' | 'James')", [true]], // HL7 testTail2
    ['Patient.name.tail().tail().given', ['Peter', 'James']],
  ])('%s', (expression, expected) => {
    expect(evaluate(names, expression)).toEqual(expected);
    expect(compile(expression).evaluate(names)).toEqual(expected);
  });

  it('selects the input items themselves and does not change the input', () => {
    expect(evaluate(names, 'name.last()')[0]).toBe(names.name[2]);
    expect(evaluate(names, 'name.tail()')).toEqual([names.name[1], names.name[2]]);
    expect(evaluate(names, 'name.tail()')[1]).toBe(names.name[2]);
    expect(names.name).toHaveLength(3);
    const result = evaluate(names, 'name.tail()');
    result.pop();
    expect(evaluate(names, 'name.tail()')).toHaveLength(2);
  });

  it.each(['last(1)', 'tail(1)', '{}.last(1)', 'tail(1, 2)'])(
    'rejects wrong arity at compile time: %s',
    (expression) => {
      expect(() => compile(expression)).toThrow(
        expect.objectContaining({ code: 'semantic/wrong-arity' }),
      );
    },
  );

  it.each(['last()', 'tail().last()', 'tail().tail()'])(
    'preserves model-less temporal provenance through %s',
    (selection) => {
      const input = { dates: ['1974-12-25', '2000-01-01', '2020-03-04'] };
      expect(evaluate(input, `dates.${selection} = @2020-03-04`)).toEqual([true]);
      expect(evaluate(input, `dates.${selection}`)).toEqual(['2020-03-04']);
    },
  );

  it('does not give a computed String the provenance of input data', () => {
    expect(evaluate({}, "'2020-03-04'.last() = @2020-03-04")).toEqual([false]);
    expect(evaluate({}, "('2000-01-01' | '2020-03-04').tail() = @2020-03-04")).toEqual([false]);
  });
});

// https://hl7.org/fhirpath/N1/#skipnum-integer-collection
// https://hl7.org/fhirpath/N1/#takenum-integer-collection
describe('skip() and take()', () => {
  it.each([
    ['(0 | 1 | 2).skip(1) = (1 | 2)', [true]], // HL7 testSkip1
    ['(0 | 1 | 2).skip(2) = 2', [true]], // HL7 testSkip2
    ["Patient.name.skip(1).given.trace('test') = ('Jim' | 'Peter' | 'James')", [true]], // testSkip3
    ['Patient.name.skip(3).given.exists() = false', [true]], // HL7 testSkip4
    ['Patient.name.skip(-1).count() = Patient.name.count()', [true]], // HL7 testSkip5
    ['Patient.name.skip(0).count() = Patient.name.count()', [true]], // HL7 testSkip6
    ['(0 | 1 | 2).skip({})', []], // HL7 testSkip7, which writes `.empty()` (T0041)
    ['{}.skip({})', []], // HL7 testSkip8
    ['Patient.name.skip(1).given', ['Jim', 'Peter', 'James']], // HL7 testDollarOrderAllowed
    ['Patient.name.skip(3).given', []], // HL7 testDollarOrderAllowedA
    ['(0 | 1 | 2).skip(3)', []],
    ['(0 | 1 | 2).skip(100)', []],
    ['(0 | 1 | 2).skip(2147483647)', []],
    ['(0 | 1 | 2).skip(-2147483648)', [0, 1, 2]],
    ['{}.skip(1)', []],
    ['{}.skip(0)', []],
    ['{}.skip(-1)', []],
    ['(0 | 1 | 2).skip(1).skip(1)', [2]],
    ['1.combine(1).combine(2).skip(1)', [1, 2]],
    ['(0 | 1 | 2).take(1) = 0', [true]], // HL7 testTake1
    ['(0 | 1 | 2).take(2) = (0 | 1)', [true]], // HL7 testTake2
    ["Patient.name.take(1).given = ('Peter' | 'James')", [true]], // HL7 testTake3
    ["Patient.name.take(2).given = ('Peter' | 'James' | 'Jim')", [true]], // HL7 testTake4
    ['Patient.name.take(3).given.count() = 5', [true]], // HL7 testTake5
    ['Patient.name.take(4).given.count() = 5', [true]], // HL7 testTake6
    ['Patient.name.take(0).given.exists() = false', [true]], // HL7 testTake7
    ['(0 | 1 | 2).take({})', []], // HL7 testTake8, which writes `.empty()` (T0041)
    ['{}.take({})', []], // HL7 testTake9
    ['(0 | 1 | 2).take(3)', [0, 1, 2]],
    ['(0 | 1 | 2).take(100)', [0, 1, 2]],
    ['(0 | 1 | 2).take(2147483647)', [0, 1, 2]],
    ['(0 | 1 | 2).take(0)', []],
    ['(0 | 1 | 2).take(-1)', []],
    ['(0 | 1 | 2).take(-2147483648)', []],
    ['{}.take(1)', []],
    ['1.combine(1).combine(2).take(2)', [1, 1]],
    ['(0 | 1 | 2).skip(1).take(1)', [1]],
    ['(0 | 1 | 2).take(2).skip(1)', [1]],
    ['(0 | 1 | 2 | 3).skip(1).take(2).tail().first()', [2]],
  ])('%s', (expression, expected) => {
    expect(evaluate(names, expression)).toEqual(expected);
    expect(compile(expression).evaluate(names)).toEqual(expected);
  });

  it('splits the input at the count: skip(n) and take(n) partition it', () => {
    const input = { values: [5, 6, 7, 8] };
    for (let count = -1; count <= 5; count++) {
      const both = evaluate(input, `values.take(${count}) | values.skip(${count})`);
      expect(both).toEqual(evaluate(input, 'values'));
      expect(evaluate(input, `values.take(${count}).combine(values.skip(${count}))`)).toEqual([
        5, 6, 7, 8,
      ]);
    }
  });

  it('selects the input items themselves, in input order', () => {
    expect(evaluate(names, 'name.skip(1)')[0]).toBe(names.name[1]);
    expect(evaluate(names, 'name.take(2)')[1]).toBe(names.name[1]);
    expect(evaluate(names, 'name.skip(0)')).toEqual([...names.name]);
    expect(names.name).toHaveLength(3);
    const result = evaluate(names, 'name.skip(0)');
    result.pop();
    expect(evaluate(names, 'name.skip(0)')).toHaveLength(3);
    const taken = evaluate(names, 'name.take(5)');
    taken.pop();
    expect(evaluate(names, 'name.take(5)')).toHaveLength(3);
  });

  it.each(['skip(0 | 1)', 'take(0 | 1)', '{}.skip(1 | 2)', '{}.take(1 | 2)'])(
    'raises eval/singleton-expected for a count of more than one item, even for empty input: %s',
    (expression) => {
      expect(() => evaluate(names, expression)).toThrow(
        expect.objectContaining({ code: 'eval/singleton-expected' }),
      );
    },
  );

  it.each([
    "skip('1')",
    'skip(1.5)',
    'skip(1.0)',
    'skip(true)',
    'skip(@2020)',
    "take('1')",
    'take(1.5)',
    'take(1.0)',
    'take(true)',
    "{}.skip('1')",
    "{}.take('1')",
    'name.skip(name.first())',
  ])('raises eval/type-mismatch for a count that is not an Integer: %s', (expression) => {
    expect(() => evaluate(names, expression)).toThrow(
      expect.objectContaining({ code: 'eval/type-mismatch' }),
    );
  });

  it.each(['skip()', 'take()', 'skip(1, 2)', 'take(1, 2)', '{}.skip()', '{}.take(1, 2)'])(
    'rejects wrong arity at compile time: %s',
    (expression) => {
      expect(() => compile(expression)).toThrow(
        expect.objectContaining({ code: 'semantic/wrong-arity' }),
      );
    },
  );

  it('evaluates the count with the focus and iteration variables of the call', () => {
    const input = { groups: [{ values: [2, 4] }, { values: [4, 2] }, { values: [7] }] };
    expect(evaluate(input, 'groups.where(values.skip($index).exists())')).toEqual([
      input.groups[0],
      input.groups[1],
    ]);
    expect(evaluate(input, 'groups.where(values.take($index + 1).count() = 2)')).toEqual([
      input.groups[1],
    ]);
    // `groups` in the argument is read from the focus where the call is written, the root.
    expect(evaluate(input, 'groups[0].values.take(groups.count()).count()')).toEqual([2]);
    expect(evaluate(input, 'groups[0].values.take(groups.count() - 2).count()')).toEqual([1]);
    expect(evaluate(input, 'groups[0].values.take(values.count()).count()')).toEqual([0]);
  });
});

// https://hl7.org/fhirpath/N1/#intersectother-collection-collection
// https://hl7.org/fhirpath/N1/#excludeother-collection-collection
describe('intersect() and exclude()', () => {
  it.each([
    ['(1 | 2 | 3).intersect(2 | 4) = 2', [true]], // HL7 testIntersect1
    ['(1 | 2).intersect(4)', []], // HL7 testIntersect2, which writes `.empty()` (T0041)
    ['(1 | 2).intersect({})', []], // HL7 testIntersect3
    ['1.combine(1).intersect(1).count() = 1', [true]], // HL7 testIntersect4
    ['(1 | 2 | 3).exclude(2 | 4) = (1 | 3)', [true]], // HL7 testExclude1
    ['(1 | 2).exclude(4) = (1 | 2)', [true]], // HL7 testExclude2
    ['(1 | 2).exclude({}) = (1 | 2)', [true]], // HL7 testExclude3
    ['1.combine(1).exclude(2).count() = 2', [true]], // HL7 testExclude4
    ['(1 | 2 | 3).exclude(2)', [1, 3]], // the spec example
    ['{}.intersect({})', []],
    ['{}.intersect(1)', []],
    ['{}.exclude({})', []],
    ['{}.exclude(1)', []],
    ['(1 | 2 | 3).exclude(1 | 2 | 3)', []],
    ['(1 | 2 | 3).exclude(1 | 2 | 3 | 4)', []],
  ])('%s', (expression, expected) => {
    expect(evaluate(names, expression)).toEqual(expected);
    expect(compile(expression).evaluate(names)).toEqual(expected);
  });

  it.each([
    // intersect() lists each item once, in the order of the input, not of `other`.
    ['(3 | 1 | 2).intersect(2 | 3 | 1)', [3, 1, 2]],
    ['3.combine(1).combine(3).combine(2).intersect(2 | 3)', [3, 2]],
    ['1.combine(1).combine(2).intersect(2.combine(1).combine(1).combine(2))', [1, 2]],
    ['(1 | 2 | 3).intersect(3 | 3 | 1)', [1, 3]],
    // exclude() keeps duplicates and the order of the input.
    ['3.combine(1).combine(3).combine(2).exclude(2)', [3, 1, 3]],
    ['3.combine(1).combine(3).exclude(4 | 5)', [3, 1, 3]],
    ['(1 | 2 | 3).exclude(2 | 2)', [1, 3]],
  ])('keeps the order of the input: %s', (expression, expected) => {
    expect(evaluate(names, expression)).toEqual(expected);
  });

  it.each([
    // The numeric types compare by value, and strings case-sensitively (N1 §6.1.1).
    ['(1 | 2).intersect(1.0)', [1]],
    ['(1 | 2).exclude(2.0)', [1]],
    ['(1.0 | 2.5).intersect(1).count()', [1]],
    ["('a' | 'A').intersect('a')", ['a']],
    ["('a' | 'A').exclude('a')", ['A']],
    ['(1 | true).intersect(true)', [true]],
    ['(1 | true).exclude(1)', [true]],
    ["(1 | '1').intersect('1')", ['1']],
    ["(1 | '1').exclude(1)", ['1']],
    // Date/time values compare at their precision (N1 §6.1.1).
    ['(@2015-02-04T10:00).combine(@2015-02-04T10:00).intersect(@2015-02-04T10:00).count()', [1]],
    ['(@2015-02-04T10:00).combine(@2015-02-04T10:00).exclude(@2015-02-04T11:00).count()', [2]],
    ['(@2015-02-04 | @2015-02-05).exclude(@2015-02-04).count()', [1]],
  ])('compares by equality: %s', (expression, expected) => {
    expect(evaluate(names, expression)).toEqual(expected);
  });

  // docs/spec-notes.md#intersect-exclude-and-undetermined-equality
  it.each([
    ['(@2020 | @2021).intersect(@2020-01).count()', [0]],
    ['(@2020 | @2021).exclude(@2020-01).count()', [2]],
    ['@2020-01.intersect(@2020).count()', [0]],
    ['@2020-01.exclude(@2020).count()', [1]],
    ['@2015-02-04T10:00.intersect(@2015-02-04T10:00:00).count()', [0]],
    ['@2015-02-04T10:00.exclude(@2015-02-04T10:00:00).count()', [1]],
  ])('does not take an undetermined comparison as equal: %s', (expression, expected) => {
    expect(evaluate(names, expression)).toEqual(expected);
  });

  it('compares complex values by their children and returns the items of the input', () => {
    const input = {
      a: [{ x: 1 }, { x: 2 }, { x: 1 }],
      b: [{ x: 1 }, { x: 3 }],
    };
    const common = evaluate(input, 'a.intersect(b)');
    expect(common).toEqual([{ x: 1 }]);
    expect(common[0]).toBe(input.a[0]);
    expect(common[0]).not.toBe(input.b[0]);
    expect(evaluate(input, 'b.intersect(a)')[0]).toBe(input.b[0]);
    expect(evaluate(input, 'a.exclude(b)')).toEqual([input.a[1]]);
    expect(evaluate(input, 'a.exclude(b)')[0]).toBe(input.a[1]);
    expect(evaluate(input, 'b.exclude(a)')).toEqual([input.b[1]]);
    expect(evaluate(input, 'a.intersect(a).count()')).toEqual([2]);
    expect(evaluate(input, 'a.exclude(a).count()')).toEqual([0]);
  });

  it('preserves model-less temporal provenance and does not give it to computed strings', () => {
    const input = { dates: ['1974-12-25', '2000-01-01', '2020-03-04'] };
    expect(evaluate(input, 'dates.intersect(@2000-01-01)')).toEqual(['2000-01-01']);
    expect(evaluate(input, 'dates.exclude(@2000-01-01)')).toEqual(['1974-12-25', '2020-03-04']);
    expect(evaluate(input, 'dates.intersect(@2000-01-01 | @2020-03-04)')).toEqual([
      '2000-01-01',
      '2020-03-04',
    ]);
    expect(evaluate({}, "'2000-01-01'.intersect(@2000-01-01).count()")).toEqual([0]);
    expect(evaluate({}, "'2000-01-01'.exclude(@2000-01-01).count()")).toEqual([1]);
  });

  it('does not change the input or the result of an earlier call', () => {
    const input = { values: [1, 2, 3] };
    for (const expression of [
      'values.exclude(9)',
      'values.exclude({})',
      'values.intersect(values)',
    ]) {
      const result = evaluate(input, expression);
      result.pop();
      expect(evaluate(input, expression)).toHaveLength(3);
    }
    expect(input.values).toEqual([1, 2, 3]);
  });

  it('evaluates the argument with the focus and iteration variables of the call', () => {
    const input = { groups: [{ values: [2, 4] }, { values: [4, 2] }, { values: [7] }] };
    // In the criteria of where(), the focus is the group, so `$this.values` and `$index` are its.
    expect(
      evaluate(input, 'groups.where(values.exclude($this.values.take($index)).count() = 1)'),
    ).toEqual([input.groups[1]]);
    expect(
      evaluate(input, 'groups.where(values.intersect($this.values.skip($index)).exists())'),
    ).toEqual([input.groups[0], input.groups[1]]);
    // At the root, the argument reads from the root.
    expect(evaluate(input, 'groups[0].values.exclude(groups[1].values.take(1))')).toEqual([2]);
    expect(evaluate(input, 'groups[0].values.intersect(groups[1].values)')).toEqual([2, 4]);
  });

  it.each(['intersect()', 'exclude()', 'intersect(1, 2)', 'exclude(1, 2)', '{}.exclude()'])(
    'rejects wrong arity at compile time: %s',
    (expression) => {
      expect(() => compile(expression)).toThrow(
        expect.objectContaining({ code: 'semantic/wrong-arity' }),
      );
    },
  );
});

// ADR-0004: the eight functions on the existing internal path, with a promise or a custom
// thenable as the input or as an argument.
describe('subsetting on the existing internal path', () => {
  it.each([
    ['last()', [2]],
    ['tail()', [1, 2]],
    ['skip(1)', [1, 2]],
    ['take(2)', [0, 1]],
    ['intersect(1 | 5)', [1]],
    ['exclude(1)', [0, 2]],
    ['union(2 | 3)', [0, 1, 2, 3]],
    ['combine(2)', [0, 1, 2, 2]],
  ])('%s after a host function', async (call, expected) => {
    for (const source of ['testAsync', 'testThenable']) {
      const options = { functions: testRegistry() };
      const expression = `(0 | 1 | 2).${source}().${call}`;
      expect(() => evaluateInternal({}, expression, options)).toThrow(
        expect.objectContaining({ code: 'eval/async-in-sync' }),
      );
      expect(await evaluateAsync({}, expression, options)).toEqual(expected);
    }
  });

  it.each([
    ['skip(ARG)', '1', [1, 2]],
    ['take(ARG)', '2', [0, 1]],
    ['intersect(ARG)', '1 | 5', [1]],
    ['exclude(ARG)', '1 | 5', [0, 2]],
    ['union(ARG)', '2 | 3', [0, 1, 2, 3]],
    ['combine(ARG)', '2', [0, 1, 2, 2]],
  ])('%s with a host function in the argument', async (call, argument, expected) => {
    for (const source of ['testAsync', 'testThenable']) {
      const options = { functions: testRegistry() };
      const expression = `(0 | 1 | 2).${call.replace('ARG', `(${argument}).${source}()`)}`;
      expect(() => evaluateInternal({}, expression, options)).toThrow(
        expect.objectContaining({ code: 'eval/async-in-sync' }),
      );
      expect(await evaluateAsync({}, expression, options)).toEqual(expected);
    }
  });

  it('keeps the exact ModelNode through every selection', () => {
    const parent = new ModelNode({ value: {}, name: 'Patient' });
    const node = new ModelNode({ value: '1974-12-25', name: 'birthDate', parent, index: 1 });
    for (const call of [
      'last()',
      'skip(0)',
      'take(1)',
      'intersect($this)',
      'exclude(1)',
      'union($this)',
      'combine({})',
    ]) {
      const result = evaluateInternal(node, `$this.${call}`, { output: 'typed' });
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(node);
    }
    expect(evaluateInternal(node, '$this.combine($this)', { output: 'typed' })).toEqual([
      node,
      node,
    ]);
    expect(node.parent).toBe(parent);
    expect(node.index).toBe(1);
  });
});
