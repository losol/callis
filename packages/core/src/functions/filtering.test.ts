import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { customThenable, hostFunction, testRegistry } from '../../test/support/test-functions.ts';
import { DEFAULT_LIMITS, evaluateAsync, evaluate as evaluateInternal } from '../api/compile.ts';
import { compile, evaluate } from '../index.ts';
import type { Collection } from '../runtime/collection.ts';

// N1 §5.2.1 and §4.5; the canonical Boolean singleton rule is the documented Callis contract.
// https://hl7.org/fhirpath/N1/#wherecriteria-expression-collection
// https://hl7.org/fhirpath/N1/#singleton-evaluation-of-collections
const input = Object.freeze({
  resourceType: 'Patient',
  telecom: Object.freeze([
    Object.freeze({ use: 'official', value: 'a' }),
    Object.freeze({ use: 'home', value: 'b' }),
    Object.freeze({ use: 'official', value: 'a' }),
  ]),
  values: Object.freeze([3, 1, 3, 2]),
});

describe('where through the public synchronous API', () => {
  it('runs the N1 telecom example, preserving order, duplicates and object identity', () => {
    const expression = "Patient.telecom.where(use = 'official')";
    const result = evaluate(input, expression);
    expect(result).toEqual([input.telecom[0], input.telecom[2]]);
    expect(result[0]).toBe(input.telecom[0]);
    expect(result[1]).toBe(input.telecom[2]);
    expect(compile(expression).evaluate(input)).toEqual(result);
    expect(input.telecom).toHaveLength(3);
  });

  it.each([
    ['values.where(true)', [3, 1, 3, 2]],
    ['values.where(false)', []],
    ['values.where({})', []],
    ['values.where($this > 1)', [3, 3, 2]],
    ['missing.where(%notEvaluated)', []],
    ['{}.where(%notEvaluated)', []],
    ['values.where($index > 0).where($index = 0)', [1]],
    ['values.where($index = 0 or $index = 2)', [3, 3]],
  ])('%s', (expression, expected) => {
    expect(evaluate(input, expression)).toEqual(expected);
    expect(compile(expression).evaluate(input)).toEqual(expected);
  });

  it.each(['0', '1', "''", "'false'", '0.0', '@2020', '1 day'])(
    'uses the established singleton Boolean fallback for %s',
    (criterion) => {
      expect(evaluate(input, `values.where(${criterion})`)).toEqual([...input.values]);
    },
  );

  it('reads Boolean properties without string or number truthiness conversions', () => {
    const flags = { rows: [{ flag: false }, { flag: true }, {}, { flag: 0 }, { flag: '' }] };
    expect(evaluate(flags, 'rows.where(flag)')).toEqual([
      flags.rows[1],
      flags.rows[3],
      flags.rows[4],
    ]);
  });

  it('keeps outer frames after nested filtering and gives inner items their own indices', () => {
    const groups = {
      groups: [
        { id: 'a', values: [2, 4] },
        { id: 'b', values: [4, 2] },
      ],
    };
    const expression =
      "groups.where(values.where($this = 4 and $index = 1)[0] = 4 and $index = 0 and $this.id = 'a').id";
    expect(evaluate(groups, expression)).toEqual(['a']);
    expect(compile(expression).evaluate(groups)).toEqual(['a']);
  });

  it('isolates inputs and evaluation variables when a compiled filter is reused', () => {
    const expression = compile('values.where($this > %threshold)');
    expect(expression.evaluate(input, { variables: { threshold: 2 } })).toEqual([3, 3]);
    const changed = expression.evaluate({ values: [5, 1] }, { variables: { threshold: 3 } });
    changed.push(99);
    expect(expression.evaluate(input, { variables: { threshold: 0 } })).toEqual([3, 1, 3, 2]);
  });

  it('keeps input provenance for model-less temporal comparison after filtering', () => {
    const dates = { dates: ['1974-12-25', '2000-01-01'] };
    expect(evaluate(dates, 'dates.where($this < @2000)[0] = @1974-12-25')).toEqual([true]);
    expect(evaluate(dates, 'dates')).toEqual(dates.dates);
  });

  it('does not read inherited input properties', () => {
    const rows = [Object.create({ flag: true }), { flag: true }];
    expect(evaluate({ rows }, 'rows.where(flag)')).toEqual([rows[1]]);
  });

  it.each(['where()', 'where(true, false)'])('rejects the arity of %s at compile time', (expr) => {
    expect(() => compile(expr)).toThrow(expect.objectContaining({ code: 'semantic/wrong-arity' }));
  });

  it('compiles criteria even for empty input and preserves evaluation-error spans', () => {
    expect(() => compile('{}.where(intentionallyMissingFunction())')).toThrow(
      expect.objectContaining({ code: 'semantic/unknown-function' }),
    );
    for (const predicate of ['flags', 'true | false']) {
      const expression = `values.where(${predicate})`;
      expect(() => evaluate({ values: [{ flags: [true, true] }] }, expression)).toThrow(
        expect.objectContaining({
          code: 'eval/singleton-expected',
          expression,
          span: expect.objectContaining({ start: 0, end: expression.length }),
        }),
      );
    }
    expect(() => evaluate(input, 'values.where(%missing)')).toThrow(
      expect.objectContaining({ code: 'eval/undefined-variable' }),
    );
  });
});

// ADR-0004: internal async compatibility, not a public async API or a public function registry.
describe('where on the existing internal lambda path', () => {
  it.each(['sync', 'promise', 'custom thenable', 'cross-realm promise'] as const)(
    'evaluates criteria sequentially with a %s result',
    async (mode) => {
      const seen: unknown[] = [];
      const predicate = hostFunction('criterion', (items) => {
        const value = items[0];
        seen.push(String(value));
        const result: Collection = [true];
        switch (mode) {
          case 'sync':
            return result;
          case 'promise':
            return Promise.resolve(result);
          case 'custom thenable':
            return customThenable(result);
          case 'cross-realm promise':
            return runInNewContext('Promise.resolve([true])') as PromiseLike<Collection>;
        }
      });
      const options = { functions: testRegistry(predicate) };
      const expression = '(1 | 2 | 3).where(criterion())';
      if (mode === 'sync') expect(evaluateInternal({}, expression, options)).toEqual([1, 2, 3]);
      else
        expect(() => evaluateInternal({}, expression, options)).toThrow(
          expect.objectContaining({ code: 'eval/async-in-sync' }),
        );
      seen.length = 0;
      expect(await evaluateAsync({}, expression, options)).toEqual([1, 2, 3]);
      expect(seen).toEqual(['1', '2', '3']);
    },
  );

  it('restores nested frames across custom thenables', async () => {
    const groups = { groups: [{ values: [1, 2] }, { values: [2, 1] }] };
    const expr =
      'groups.where(values.where($this.testThenable() = 2 and $index = 1)[0] = 2 and $index = 0)';
    expect(await evaluateAsync(groups, expr, { functions: testRegistry() })).toEqual([
      groups.groups[0],
    ]);
  });

  it('waits for each item before evaluating the next and stops after a rejected criterion', async () => {
    const events: string[] = [];
    const failure = new Error('criterion failure');
    const predicate = hostFunction('criterion', async (items) => {
      const item = String(items[0]);
      events.push(`start ${item}`);
      await Promise.resolve();
      if (item === '2') throw failure;
      events.push(`end ${item}`);
      return [true];
    });
    await expect(
      evaluateAsync({}, '(1 | 2 | 3).where(criterion())', {
        functions: testRegistry(predicate),
      }),
    ).rejects.toBe(failure);
    expect(events).toEqual(['start 1', 'end 1', 'start 2']);
  });

  it('checks criterion cardinality after an asynchronous result', async () => {
    const predicate = hostFunction('criterion', () => customThenable([true, false]));
    await expect(
      evaluateAsync({}, '1.where(criterion())', { functions: testRegistry(predicate) }),
    ).rejects.toMatchObject({ code: 'eval/singleton-expected' });
  });
});

// N1 §5.2.2 select(projection), with the 3.0.0 examples.
// https://hl7.org/fhirpath/N1/#selectprojection-expression-collection
// https://hl7.org/fhirpath/STU3/en/index.html#selectprojection-this-index--any--collection
const bundle = Object.freeze({
  resourceType: 'Bundle',
  entry: Object.freeze([
    {
      resource: {
        resourceType: 'Patient',
        id: 'p1',
        telecom: [
          { system: 'phone', value: '555-1' },
          { system: 'email', value: 'a@example.org' },
        ],
        name: [
          { use: 'usual', given: ['Ada', 'Augusta'], family: 'Lovelace' },
          { use: 'official', given: ['Augusta'], family: 'King' },
        ],
      },
    },
    { resource: { resourceType: 'Observation', id: 'o1' } },
    {
      resource: {
        resourceType: 'Patient',
        id: 'p2',
        telecom: [{ system: 'phone', value: '555-2' }],
      },
    },
    { resource: { resourceType: 'patient', id: 'lowercase' } },
  ]),
});

describe('select through the public synchronous API', () => {
  it('keeps only the Patient resources of a Bundle (N1 example)', () => {
    const result = evaluate(bundle, 'Bundle.entry.select(resource as Patient)');
    expect(result).toEqual([bundle.entry[0]?.resource, bundle.entry[2]?.resource]);
    expect(result[0]).toBe(bundle.entry[0]?.resource);
  });

  it.each([
    [
      "Bundle.entry.select((resource as Patient).telecom.where(system = 'phone')).value",
      ['555-1', '555-2'],
    ], // N1
    [
      "Bundle.entry.resource.name.where(use = 'usual').select(given.first() + ' ' + family)",
      ['Ada Lovelace'],
    ], // N1
    [
      "Bundle.entry.resource.name.where(use = 'usual').select(given.first() & ' ' & family)",
      ['Ada Lovelace'],
    ], // 3.0.0
    ['Bundle.entry.resource.name.select(given)', ['Ada', 'Augusta', 'Augusta']],
    ['Bundle.entry.resource.name.select(given | family).count()', [5]],
    ["Bundle.entry.resource.name.select(use.contains('x'))", [false, false]],
    ['Bundle.entry.resource.name.select($index)', [0, 1]],
    ['Bundle.entry.resource.name.select($this.family)', ['Lovelace', 'King']],
    ['Bundle.entry.resource.name.select({})', []],
    ['missing.select(%notEvaluated)', []],
    ['{}.select(%notEvaluated)', []],
    ['(1 | 2 | 3).select($this * 10)', [10, 20, 30]],
    ['(1 | 2).select($this | 1)', [1, 2, 1]],
  ] as const)('%s', (expression, expected) => {
    expect(evaluate(bundle, expression)).toEqual(expected);
    expect(compile(expression).evaluate(bundle)).toEqual(expected);
  });

  it('gives nested projections their own $this and $index, and restores the outer ones', () => {
    const groups = { groups: [{ values: [2, 4] }, { values: [6] }] };
    expect(evaluate(groups, 'groups.select(values.select($this + $index))')).toEqual([2, 5, 6]);
    expect(evaluate(groups, 'groups.select(values.select($index).count() + $index)')).toEqual([
      2, 2,
    ]);
    expect(
      evaluate(groups, 'groups.select(values.where($index = 0).select($index) | $index)'),
    ).toEqual([0, 0, 1]);
  });

  it('evaluates the projection for every item, and surfaces its errors', () => {
    expect(() => evaluate({ rows: [{ a: 1 }, { a: [1, 2] }] }, 'rows.select(a + 1)')).toThrow(
      expect.objectContaining({ code: 'eval/singleton-expected' }),
    );
  });

  it.each(['select()', 'select(1, 2)'])('rejects the arity of %s at compile time', (expr) => {
    expect(() => compile(expr)).toThrow(expect.objectContaining({ code: 'semantic/wrong-arity' }));
  });
});

// N1 §5.2.3 repeat(projection), as 3.0.0 describes it: a queue of items; a projected item joins
// the result and the queue only if no result item equals it.
// https://hl7.org/fhirpath/N1/#repeatprojection-expression-collection
// https://hl7.org/fhirpath/STU3/en/index.html#repeatprojection-this--collection--collection
describe('repeat through the public synchronous API', () => {
  const questionnaire = Object.freeze({
    resourceType: 'Questionnaire',
    item: [
      {
        linkId: '1',
        item: [{ linkId: '1.1', item: [{ linkId: '1.1.1' }] }, { linkId: '1.2' }],
      },
      { linkId: '2', answerOption: [{ valueString: 'x', item: [{ linkId: 'not-an-item' }] }] },
    ],
  });
  const valueSet = Object.freeze({
    resourceType: 'ValueSet',
    expansion: {
      contains: [
        { code: 'a', contains: [{ code: 'a1' }, { code: 'a2', contains: [{ code: 'a2x' }] }] },
        { code: 'b' },
      ],
    },
  });

  it('walks nested items, breadth first, and ends (N1 example)', () => {
    expect(evaluate(questionnaire, 'Questionnaire.repeat(item).linkId')).toEqual([
      '1',
      '2',
      '1.1',
      '1.2',
      '1.1.1',
    ]);
    // Unlike repeat(item), descendants().select(item) finds items under other elements too.
    expect(evaluate(questionnaire, 'Questionnaire.descendants().select(item).linkId')).toContain(
      'not-an-item',
    );
    expect(evaluate(valueSet, 'ValueSet.expansion.repeat(contains).code')).toEqual([
      'a',
      'b',
      'a1',
      'a2',
      'a2x',
    ]);
  });

  it('returns the result items themselves, and the input items only when projected', () => {
    const [first] = evaluate(questionnaire, 'Questionnaire.repeat(item)');
    expect(first).toBe(questionnaire.item[0]);
    expect(evaluate(questionnaire, 'Questionnaire.repeat(item).resourceType')).toEqual([]);
    expect(evaluate(null, '(1 | 2).repeat(1 | 2 | 3)')).toEqual([1, 2, 3]);
  });

  it.each([
    [
      "Patient.name.repeat('test')",
      { resourceType: 'Patient', name: [{ use: 'a' }, { use: 'b' }] },
      ['test'],
    ], // testRepeat5
    ["'a'.repeat('a')", null, ['a']],
    ['{}.repeat(%notEvaluated)', null, []],
    ['missing.repeat(%notEvaluated)', {}, []],
    ['(1 | 2).repeat({})', null, []],
    ['3.repeat(iif($this > 0, $this - 1))', null, [2, 1, 0]],
    // Equal items, by =, are added once; an undetermined comparison is not equality (3.0.0).
    ['(1 | 2).repeat(1.0)', null, [1]],
    ['@2020.repeat(@2020 | @2020-01)', null, ['2020', '2020-01']],
    ["'a'.repeat('A')", null, ['A']],
  ] as const)('%s', (expression, input, expected) => {
    expect(evaluate(input, expression)).toEqual(expected);
  });

  it('adds an item once even when two JSON objects hold it', () => {
    const twins = { item: [{ linkId: 'a' }, { linkId: 'a' }, { linkId: 'b' }] };
    const result = evaluate(twins, 'repeat(item)');
    expect(result).toEqual([twins.item[0], twins.item[2]]);
    expect(result[0]).toBe(twins.item[0]);
  });

  it('leaves $index that of the call, as 3.0.0 does not set it', () => {
    expect(evaluate(null, '(1 | 2).repeat($index)')).toEqual([]);
    expect(evaluate({ rows: [{}, {}] }, 'rows.select(repeat($index))')).toEqual([0, 1]);
    expect(evaluate(questionnaire, 'Questionnaire.repeat(item.where($index = 0)).linkId')).toEqual([
      '1',
      '1.1',
      '1.1.1',
    ]);
  });

  it.each(['repeat()', 'repeat(item, item)'])('rejects the arity of %s at compile time', (expr) => {
    expect(() => compile(expr)).toThrow(expect.objectContaining({ code: 'semantic/wrong-arity' }));
  });
});

// docs/architecture.md#security-and-robustness: repeat() stops a projection that never runs out.
describe('the repeat() limit', () => {
  const generating = "'x'.repeat($this & 'x')";

  it('has a documented finite default', () => {
    expect(DEFAULT_LIMITS.maxRepeatItems).toBe(5_000);
  });

  // Each walk compares 5,000 new items with the earlier ones, about a second under Vitest.
  it('stops a value-generating projection at the default limit, in sync and async mode', {
    timeout: 20_000,
  }, async () => {
    expect(() => evaluateInternal(null, generating)).toThrow(
      expect.objectContaining({ code: 'eval/limit-exceeded', expression: generating }),
    );
    await expect(evaluateAsync(null, generating)).rejects.toMatchObject({
      code: 'eval/limit-exceeded',
    });
  });

  it('stops at a custom limits.maxRepeatItems, in sync and async mode', async () => {
    const options = { limits: { maxRepeatItems: 5 } };
    expect(() => evaluateInternal(null, generating, options)).toThrow(
      expect.objectContaining({ code: 'eval/limit-exceeded' }),
    );
    await expect(evaluateAsync(null, generating, options)).rejects.toMatchObject({
      code: 'eval/limit-exceeded',
    });
    const counting = '0.repeat(iif($this < 5, $this + 1))';
    expect(evaluateInternal(null, counting, options)).toEqual([1, 2, 3, 4, 5]);
    expect(() => evaluateInternal(null, counting, { limits: { maxRepeatItems: 4 } })).toThrow(
      expect.objectContaining({ code: 'eval/limit-exceeded' }),
    );
    expect(evaluateInternal(null, counting, { limits: {} })).toEqual([1, 2, 3, 4, 5]);
  });

  it('counts the items of each repeat() call on its own', () => {
    const expression = '(0 | 10).select($this.repeat(iif($this mod 10 < 3, $this + 1)))';
    const options = { limits: { maxRepeatItems: 3 } };
    expect(evaluateInternal(null, expression, options)).toEqual([1, 2, 3, 11, 12, 13]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '10', null])(
    'rejects maxRepeatItems %s, even when the expression has no repeat()',
    (maxRepeatItems) => {
      expect(() => evaluateInternal(null, '1', { limits: { maxRepeatItems } as never })).toThrow(
        expect.objectContaining({ code: 'eval/invalid-argument' }),
      );
    },
  );

  it.each([null, 5, 'many'])('rejects limits %s', (limits) => {
    expect(() => evaluateInternal(null, '1', { limits } as never)).toThrow(
      expect.objectContaining({ code: 'eval/invalid-argument' }),
    );
  });
});

// T0021's cancellation signal: repeat() checks it before each item it projects, so an abort during
// a long walk stops it. The aborting call answers synchronously, so only that check can see it.
describe('repeat() and the cancellation signal', () => {
  const reason = new Error('stop');

  function stepper(controller: AbortController, calls: number[], firstAsync: boolean) {
    return hostFunction('step', (items) => {
      const value = Number(items[0]);
      calls.push(value);
      if (value === 2) controller.abort(reason);
      const next: Collection = [value + 1];
      return firstAsync && value === 0 ? Promise.resolve(next) : next;
    });
  }

  it('stops a running walk with eval/aborted in sync mode', () => {
    const controller = new AbortController();
    const calls: number[] = [];
    const options = {
      functions: testRegistry(stepper(controller, calls, false)),
      signal: controller.signal,
    };
    expect(() => evaluateInternal(null, '0.repeat(step())', options)).toThrow(
      expect.objectContaining({ code: 'eval/aborted', cause: reason }),
    );
    expect(calls).toEqual([0, 1, 2]);
  });

  it('stops a running walk with eval/aborted in async mode', async () => {
    const controller = new AbortController();
    const calls: number[] = [];
    const options = {
      functions: testRegistry(stepper(controller, calls, true)),
      signal: controller.signal,
    };
    await expect(evaluateAsync(null, '0.repeat(step())', options)).rejects.toMatchObject({
      code: 'eval/aborted',
      cause: reason,
    });
    expect(calls).toEqual([0, 1, 2]);
  });

  it('walks to the end with a signal that is not aborted', async () => {
    const options = { signal: new AbortController().signal };
    const expression = '0.repeat(iif($this < 3, $this + 1))';
    expect(evaluateInternal(null, expression, options)).toEqual([1, 2, 3]);
    expect(await evaluateAsync(null, expression, options)).toEqual([1, 2, 3]);
  });
});

// N1 §5.2.4 ofType(type): the target resolution of is and as; T0008's model-less resource names.
// https://hl7.org/fhirpath/N1/#oftypetype-type-specifier-collection
// docs/spec-notes.md#resource-type-names-without-a-model, #unresolved-type-specifiers-are-execution-errors
describe('ofType through the public synchronous API', () => {
  it('keeps the Patient resources of a Bundle by their own resourceType (N1 example)', () => {
    const result = evaluate(bundle, 'Bundle.entry.resource.ofType(Patient)');
    expect(result).toEqual([bundle.entry[0]?.resource, bundle.entry[2]?.resource]);
    expect(result[1]).toBe(bundle.entry[2]?.resource);
    expect(evaluate(bundle, 'Bundle.entry.resource.ofType(Observation).id')).toEqual(['o1']);
  });

  it.each(['Practitioner', 'Patiant', 'Resource', 'DomainResource'])(
    'gives empty for the resource name %s that no item has',
    (name) => {
      expect(evaluate(bundle, `Bundle.entry.resource.ofType(${name})`)).toEqual([]);
    },
  );

  it('does not read inherited or non-string resourceType properties', () => {
    const rows = [
      Object.create({ resourceType: 'Patient' }),
      { resourceType: 5 },
      { resourceType: 'Patient ' },
      { resourceType: 'Patient' },
    ];
    expect(evaluate({ rows }, 'rows.ofType(Patient)')).toEqual([rows[3]]);
  });

  it.each([
    ["(1 | 'a' | 2.5 | true | @2020).ofType(Integer)", [1]],
    ["(1 | 'a' | 2.5 | true | @2020).ofType(String)", ['a']],
    ["(1 | 'a' | 2.5 | true | @2020).ofType(System.Decimal)", [2.5]],
    ["(1 | 'a' | 2.5 | true | @2020).ofType(Boolean)", [true]],
    ["(1 | 'a' | 2.5 | true | @2020).ofType(Date)", ['2020']],
    ["(1 | 'a').ofType(System.Any)", [1, 'a']],
    ['1.ofType(Decimal)', []],
    ['@2020.ofType(DateTime)', []],
    ["1 'mg'.ofType(Quantity).toString()", ["1 'mg'"]],
    ['{}.ofType(Integer)', []],
  ] as const)('%s', (expression, expected) => {
    expect(evaluate(null, expression)).toEqual(expected);
  });

  it('types input strings as Strings, not as Dates', () => {
    const input = { d: ['2020-01-01', 'x'] };
    expect(evaluate(input, 'd.ofType(String)')).toEqual(['2020-01-01', 'x']);
    expect(evaluate(input, 'd.ofType(Date)')).toEqual([]);
  });

  it.each([
    'Bundle.entry.resource.ofType(System.Patient)',
    'Bundle.entry.resource.ofType(FHIR.Patient)',
    'Bundle.entry.resource.ofType(Foo.Patient)',
    '{}.ofType(System.Patient)',
    '{}.ofType(FHIR.Patient)',
    'missing.ofType(FHIR.Patient)',
  ])('%s raises eval/unknown-type, also on empty input', (expression) => {
    expect(() => evaluate(bundle, expression)).toThrow(
      expect.objectContaining({ code: 'eval/unknown-type', expression }),
    );
  });

  it('raises eval/unknown-type only where the call is evaluated', () => {
    expect(evaluate(null, 'iif(true, 1, {}.ofType(FHIR.Patient))')).toEqual([1]);
  });

  it.each([
    ['ofType()', 'semantic/wrong-arity'],
    ['ofType(Patient, Patient)', 'semantic/wrong-arity'],
    ["ofType('Patient')", 'semantic/invalid-argument'],
  ])('rejects %s at compile time', (expression, code) => {
    expect(() => compile(expression)).toThrow(expect.objectContaining({ code }));
  });
});

// ADR-0004: select() and repeat() evaluate lambdas on the internal sync/async path; ofType() has
// none, and works the same in both modes.
describe('select, repeat and ofType on the internal sync and async paths', () => {
  const modes = ['sync', 'promise', 'custom thenable', 'cross-realm promise'] as const;

  function projection(mode: (typeof modes)[number], seen: string[]) {
    return hostFunction('project', (items) => {
      const value = Number(items[0]);
      seen.push(String(value));
      const result: Collection = value < 3 ? [value + 1] : [];
      switch (mode) {
        case 'sync':
          return result;
        case 'promise':
          return Promise.resolve(result);
        case 'custom thenable':
          return customThenable(result);
        case 'cross-realm promise':
          return runInNewContext('Promise.resolve(answer)', {
            answer: result,
          }) as PromiseLike<Collection>;
      }
    });
  }

  it.each(modes)('select() projects each item in order with a %s result', async (mode) => {
    const seen: string[] = [];
    const options = { functions: testRegistry(projection(mode, seen)) };
    const expression = '(0 | 1 | 2 | 3).select(project())';
    if (mode === 'sync') expect(evaluateInternal({}, expression, options)).toEqual([1, 2, 3]);
    else
      expect(() => evaluateInternal({}, expression, options)).toThrow(
        expect.objectContaining({ code: 'eval/async-in-sync' }),
      );
    seen.length = 0;
    expect(await evaluateAsync({}, expression, options)).toEqual([1, 2, 3]);
    expect(seen).toEqual(['0', '1', '2', '3']);
  });

  it.each(modes)('repeat() projects the queue in order with a %s result', async (mode) => {
    const seen: string[] = [];
    const options = { functions: testRegistry(projection(mode, seen)) };
    const expression = '0.repeat(project())';
    if (mode === 'sync') expect(evaluateInternal({}, expression, options)).toEqual([1, 2, 3]);
    else
      expect(() => evaluateInternal({}, expression, options)).toThrow(
        expect.objectContaining({ code: 'eval/async-in-sync' }),
      );
    seen.length = 0;
    expect(await evaluateAsync({}, expression, options)).toEqual([1, 2, 3]);
    expect(seen).toEqual(['0', '1', '2', '3']);
  });

  it('keeps nested frames across custom thenables', async () => {
    const groups = { groups: [{ values: [1, 2] }, { values: [3] }] };
    const options = { functions: testRegistry() };
    expect(
      await evaluateAsync(
        groups,
        'groups.select(values.select($this.testThenable() + $index) | $index)',
        options,
      ),
    ).toEqual([1, 3, 0, 3, 1]);
    expect(
      await evaluateAsync(
        groups,
        'groups.select(values.repeat(iif($this.testThenable() < 4, $this + 1)))',
        options,
      ),
    ).toEqual([2, 3, 4, 4]);
  });

  it('switches to async mid-walk and keeps the remaining queue', async () => {
    const events: string[] = [];
    const step = hostFunction('step', (items) => {
      const value = Number(items[0]);
      events.push(String(value));
      if (value === 0) return [1, 2];
      if (value === 1) return customThenable([3]);
      if (value === 2) return Promise.resolve([3, 4]);
      return [];
    });
    expect(await evaluateAsync({}, '0.repeat(step())', { functions: testRegistry(step) })).toEqual([
      1, 2, 3, 4,
    ]);
    expect(events).toEqual(['0', '1', '2', '3', '4']);
  });

  it('propagates a rejected projection without projecting later items', async () => {
    const failure = new Error('projection failed');
    let calls = 0;
    const failing = hostFunction('project', () => {
      calls++;
      return Promise.reject(failure);
    });
    await expect(
      evaluateAsync({}, '(1 | 2).repeat(project())', { functions: testRegistry(failing) }),
    ).rejects.toBe(failure);
    await expect(
      evaluateAsync({}, '(1 | 2).select(project())', { functions: testRegistry(failing) }),
    ).rejects.toBe(failure);
    expect(calls).toBe(2);
  });

  it('applies ofType() in async mode as in sync mode', async () => {
    expect(await evaluateAsync(bundle, 'Bundle.entry.resource.ofType(Patient).id')).toEqual([
      'p1',
      'p2',
    ]);
    await expect(evaluateAsync(null, '{}.ofType(System.Patient)')).rejects.toMatchObject({
      code: 'eval/unknown-type',
    });
  });
});
