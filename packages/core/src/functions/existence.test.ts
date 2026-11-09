import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { customThenable, hostFunction, testRegistry } from '../../test/support/test-functions.ts';
import {
  compile as compileInternal,
  evaluateAsync,
  evaluate as evaluateInternal,
} from '../api/compile.ts';
import { compile, evaluate } from '../index.ts';
import type { Collection } from '../runtime/collection.ts';

// N1 §5.1.2/5.1.10 and the canonical §4.5 Boolean singleton rule.
// https://hl7.org/fhirpath/N1/#existscriteria-expression-boolean
// https://hl7.org/fhirpath/N1/#count-integer
// https://hl7.org/fhirpath/N1/#singleton-evaluation-of-collections
const patient = Object.freeze({
  resourceType: 'Patient',
  name: Object.freeze([{ given: ['Ada'] }, { given: ['Mina'] }]),
  identifier: Object.freeze([{ use: 'official' }]),
  telecom: Object.freeze([
    { system: 'phone', use: 'mobile' },
    { system: 'email', use: 'home' },
  ]),
  generalPractitioner: Object.freeze([{ resourceType: 'Practitioner' }]),
});

describe('exists and count through the public synchronous API', () => {
  it.each([
    ['Patient.name.exists()', true],
    ["Patient.identifier.exists(use = 'official')", true],
    ["Patient.telecom.exists(system = 'phone' and use = 'mobile')", true],
    ['Patient.generalPractitioner.exists($this is Practitioner)', true],
    ['Patient.name.count()', 2],
    ['missing.exists()', false],
    ['missing.count()', 0],
    ['{}.exists()', false],
    ['{}.exists(%notEvaluated)', false],
    ['{}.count()', 0],
    ['false.exists()', true],
    ['false.count()', 1],
    ['name.exists(false)', false],
    ['name.exists({})', false],
    ["name.exists(given = 'Unknown')", false],
    ["name.where(given = 'Ada').exists()", true],
    ["name.where(given = 'Ada').count()", 1],
    ["name.where(given = 'Unknown').count()", 0],
    ['name.exists($index = 1)', true],
    ['name.exists($index = 2)', false],
    ['name.where($index = 1).exists($index = 0)', true],
    ['name.exists($this.given = %target)', true],
  ] as const)('%s', (expression, expected) => {
    const options = { variables: { target: 'Mina' } };
    expect(evaluate(patient, expression, options)).toEqual([expected]);
    expect(compile(expression).evaluate(patient, options)).toEqual([expected]);
  });

  it.each(['0', "''", "'false'", '0.0', '@2020', '1 day'])(
    'uses the same canonical single non-Boolean fallback as where for %s',
    (criterion) => {
      expect(evaluate(patient, `name.exists(${criterion})`)).toEqual([true]);
      expect(evaluate(patient, `name.where(${criterion}).exists()`)).toEqual([true]);
    },
  );

  it('counts input items, including duplicate values, without mutating input', () => {
    const rows = Object.freeze([false, false, { x: 1 }, { x: 1 }]);
    expect(evaluate(rows, '$this.count()')).toEqual([4]);
    expect(evaluate(rows, '$this.exists()')).toEqual([true]);
    expect(rows).toHaveLength(4);
    expect(evaluate({ nested: [[1, 2], [3], null] }, 'nested.count()')).toEqual([3]);
  });

  it('keeps outer frames after nested exists and where criteria', () => {
    const input = {
      groups: [
        { id: 'a', values: [2, 4] },
        { id: 'b', values: [4, 2] },
      ],
    };
    const expression =
      "groups.where(values.exists($this = 4 and $index = 1) and $index = 0 and $this.id = 'a').count()";
    expect(evaluate(input, expression)).toEqual([1]);
    expect(
      evaluate(
        input,
        "groups.exists(values.where($index = 1)[0] = 2 and $this.id = 'b' and $index = 1)",
      ),
    ).toEqual([true]);
  });

  it('short-circuits on a match without evaluating a later invalid or failing item', () => {
    const input = { rows: [{ flag: false }, { flag: true }, { flag: [true, false] }] };
    expect(evaluate(input, 'rows.exists(flag)')).toEqual([true]);
    expect(() => evaluate(input, 'rows.where(flag).exists()')).toThrow(
      expect.objectContaining({ code: 'eval/singleton-expected' }),
    );
    const failure = new Error('later getter');
    const rows = [
      { flag: true },
      {
        get flag(): never {
          throw failure;
        },
      },
    ];
    expect(evaluate({ rows }, 'rows.exists(flag)')).toEqual([true]);
  });

  it('does not hide errors reached before a match and retains the criterion span', () => {
    const expression = 'rows.exists(flag)';
    expect(() =>
      evaluate({ rows: [{ flag: false }, { flag: [true, true] }, { flag: true }] }, expression),
    ).toThrow(
      expect.objectContaining({
        code: 'eval/singleton-expected',
        expression,
        span: expect.objectContaining({ start: 0, end: expression.length }),
      }),
    );
    expect(() => evaluate(patient, 'name.exists(%missing)')).toThrow(
      expect.objectContaining({ code: 'eval/undefined-variable' }),
    );
  });

  it.each(['exists(true, false)', 'count(1)'])(
    'rejects arity for %s at compile time',
    (expression) => {
      expect(() => compile(expression)).toThrow(
        expect.objectContaining({ code: 'semantic/wrong-arity' }),
      );
    },
  );

  it('still checks a criterion at compile time even on empty input', () => {
    expect(() => compile('{}.exists(intentionallyMissingFunction())')).toThrow(
      expect.objectContaining({ code: 'semantic/unknown-function' }),
    );
  });

  it('isolates variables and inputs between runs of one compiled predicate', () => {
    const expression = compile('values.exists($this > %threshold)');
    expect(expression.evaluate({ values: [1, 2] }, { variables: { threshold: 3 } })).toEqual([
      false,
    ]);
    expect(expression.evaluate({ values: [4] }, { variables: { threshold: 3 } })).toEqual([true]);
    expect(expression.evaluate({ values: [] }, { variables: { threshold: 0 } })).toEqual([false]);
    expect(evaluate({ values: ['1974-12-25'] }, 'values.exists($this = @1974-12-25)')).toEqual([
      true,
    ]);
  });
});

// ADR-0004: exercise the existing internal abstraction without adding public async/hooks/options.
describe('exists on the internal sync and async lambda paths', () => {
  it.each(['sync', 'promise', 'custom thenable', 'cross-realm promise'] as const)(
    'stops after the first matching %s criterion',
    async (mode) => {
      const seen: string[] = [];
      const predicate = hostFunction('criterion', (items) => {
        const value = String(items[0]);
        seen.push(value);
        const result: Collection = [value === '2'];
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
      const options = { functions: testRegistry(predicate) };
      const expression = '(1 | 2 | 3).exists(criterion())';
      if (mode === 'sync') expect(evaluateInternal({}, expression, options)).toEqual([true]);
      else
        expect(() => evaluateInternal({}, expression, options)).toThrow(
          expect.objectContaining({ code: 'eval/async-in-sync' }),
        );
      seen.length = 0;
      expect(await evaluateAsync({}, expression, options)).toEqual([true]);
      expect(seen).toEqual(['1', '2']);
    },
  );

  it('continues after a sync-to-async transition with the right indices', async () => {
    const events: string[] = [];
    const predicate = hostFunction('criterion', (items) => {
      const value = String(items[0]);
      events.push(value);
      if (value === '1') return [false];
      if (value === '2') return customThenable([false]);
      if (value === '3') return Promise.resolve([true]);
      throw new Error('must not visit the fourth item');
    });
    expect(
      await evaluateAsync({}, '(1 | 2 | 3 | 4).exists(criterion())', {
        functions: testRegistry(predicate),
      }),
    ).toEqual([true]);
    expect(events).toEqual(['1', '2', '3']);
    expect(
      await evaluateAsync({}, '(1 | 2 | 3).exists($this.testThenable() > 4)', {
        functions: testRegistry(),
      }),
    ).toEqual([false]);
  });

  it('propagates rejection and multi-item errors before a match, without later calls', async () => {
    const failure = new Error('criterion failed');
    let calls = 0;
    const predicate = hostFunction('criterion', () => {
      calls++;
      return Promise.reject(failure);
    });
    await expect(
      evaluateAsync({}, '(1 | 2).exists(criterion())', {
        functions: testRegistry(predicate),
      }),
    ).rejects.toBe(failure);
    expect(calls).toBe(1);
    const invalid = hostFunction('criterion', () => customThenable([true, false]));
    await expect(
      evaluateAsync({}, '1.exists(criterion())', { functions: testRegistry(invalid) }),
    ).rejects.toMatchObject({ code: 'eval/singleton-expected' });
  });

  it('isolates nested frames and concurrent evaluations of a compiled expression', async () => {
    const compiled = compileInternal(
      'groups.exists(values.exists($this.testThenable() = %target and $index = 1) and $index = 0)',
      { functions: testRegistry() },
    );
    const input = { groups: [{ values: [1, 2] }, { values: [2, 1] }] };
    expect(
      await Promise.all([
        compiled.evaluateAsync(input, { variables: { target: 2 } }),
        compiled.evaluateAsync(input, { variables: { target: 1 } }),
      ]),
    ).toEqual([[true], [false]]);
  });
});

// N1 §5.1.1 empty() and §5.1.3 all(criteria); all() uses the same criteria helper as exists().
// https://hl7.org/fhirpath/N1/#empty-boolean
// https://hl7.org/fhirpath/N1/#allcriteria-expression-boolean
// https://hl7.org/fhirpath/STU3/en/index.html#allcriteria--this-index--boolean--boolean
describe('empty and all through the public synchronous API', () => {
  it.each([
    ['Patient.link.empty()', true], // 3.0.0 example
    ['Patient.name.empty()', false],
    ['missing.empty()', true],
    ['{}.empty()', true],
    ['false.empty()', false],
    ["''.empty()", false],
    ["name.where(given = 'Unknown').empty()", true],
    ['Patient.generalPractitioner.all($this is Practitioner)', true], // N1 example
    ["Patient.telecom.all(system = 'phone')", false],
    ['Patient.telecom.all(system.exists() and use.exists())', true],
    ['name.all(given.exists())', true], // testAllTrue3
    ['name.all(period.exists())', false], // testAllTrue4
    ['missing.all(false)', true],
    ['{}.all(%notEvaluated)', true],
    ['name.all(true)', true],
    ['name.all(false)', false],
    ['name.all({})', false],
    ['name.all($index < 2)', true],
    ['name.all($index = 0)', false],
    ['name.all($this.given = %target or $index = 0)', true],
    ['name.where($index = 1).all($index = 0)', true],
  ] as const)('%s', (expression, expected) => {
    const options = { variables: { target: 'Mina' } };
    expect(evaluate(patient, expression, options)).toEqual([expected]);
    expect(compile(expression).evaluate(patient, options)).toEqual([expected]);
  });

  it('is false for a generalPractitioner of another type (N1 example)', () => {
    const managed = {
      resourceType: 'Patient',
      generalPractitioner: [{ resourceType: 'Practitioner' }, { resourceType: 'Organization' }],
    };
    expect(evaluate(managed, 'generalPractitioner.all($this is Practitioner)')).toEqual([false]);
  });

  it.each(['0', "''", "'false'", '0.0', '@2020', '1 day'])(
    'uses the same canonical single non-Boolean fallback as where for %s',
    (criterion) => {
      expect(evaluate(patient, `name.all(${criterion})`)).toEqual([true]);
    },
  );

  it('stops at the first item that does not match, without evaluating later items', () => {
    const input = { rows: [{ flag: true }, { flag: false }, { flag: [true, false] }] };
    expect(evaluate(input, 'rows.all(flag)')).toEqual([false]);
    expect(() => evaluate(input, 'rows.where(flag).count()')).toThrow(
      expect.objectContaining({ code: 'eval/singleton-expected' }),
    );
    const rows = [
      { flag: false },
      {
        get flag(): never {
          throw new Error('later getter');
        },
      },
    ];
    expect(evaluate({ rows }, 'rows.all(flag)')).toEqual([false]);
  });

  it('does not hide errors reached before an item that does not match', () => {
    const expression = 'rows.all(flag)';
    expect(() =>
      evaluate({ rows: [{ flag: true }, { flag: [true, true] }, { flag: false }] }, expression),
    ).toThrow(
      expect.objectContaining({
        code: 'eval/singleton-expected',
        expression,
        span: expect.objectContaining({ start: 0, end: expression.length }),
      }),
    );
    expect(() => evaluate(patient, 'name.all(%missing)')).toThrow(
      expect.objectContaining({ code: 'eval/undefined-variable' }),
    );
  });

  it('isolates variables and inputs between runs of one compiled criterion', () => {
    const expression = compile('values.all($this > %threshold)');
    expect(expression.evaluate({ values: [4, 2] }, { variables: { threshold: 3 } })).toEqual([
      false,
    ]);
    expect(expression.evaluate({ values: [4] }, { variables: { threshold: 3 } })).toEqual([true]);
    expect(expression.evaluate({ values: [] }, { variables: { threshold: 9 } })).toEqual([true]);
  });
});

// N1 §5.1.4–5.1.7: allTrue(), anyTrue(), allFalse() and anyFalse() take a collection of Booleans.
// https://hl7.org/fhirpath/N1/#alltrue-boolean
// https://hl7.org/fhirpath/N1/#anytrue-boolean
// https://hl7.org/fhirpath/N1/#allfalse-boolean
// https://hl7.org/fhirpath/N1/#anyfalse-boolean
describe('allTrue, anyTrue, allFalse and anyFalse', () => {
  it.each([
    ['{}', true, false, true, false],
    ['true', true, true, false, false],
    ['false', false, false, true, true],
    ['true.combine(false)', false, true, false, true],
    ['true.combine(true)', true, true, false, false],
    ['false.combine(false)', false, false, true, true],
  ] as const)('%s', (input, allTrue, anyTrue, allFalse, anyFalse) => {
    expect(evaluate(null, `${input}.allTrue()`)).toEqual([allTrue]);
    expect(evaluate(null, `${input}.anyTrue()`)).toEqual([anyTrue]);
    expect(evaluate(null, `${input}.allFalse()`)).toEqual([allFalse]);
    expect(evaluate(null, `${input}.anyFalse()`)).toEqual([anyFalse]);
  });

  // The spec examples project Observation components with select(component.value > 90 'mm[Hg]');
  // select() comes with T0042, so the test-only testSelect() runs the same comparison.
  it.each([
    ['allTrue', false],
    ['anyTrue', true],
    ['allFalse', false],
    ['anyFalse', true],
  ] as const)('%s() of projected comparisons (N1 examples)', (name, expected) => {
    const expression = `(120 'mm[Hg]').combine(85 'mm[Hg]').testSelect($this > 90 'mm[Hg]').${name}()`;
    expect(evaluateInternal(null, expression, { functions: testRegistry() })).toEqual([expected]);
  });

  it('reads Booleans from input data', () => {
    const input = { flags: [true, false, true] };
    expect(evaluate(input, 'flags.allTrue()')).toEqual([false]);
    expect(evaluate(input, 'flags.anyTrue()')).toEqual([true]);
    expect(evaluate(input, 'flags.where($this).allTrue()')).toEqual([true]);
    expect(evaluate(input, 'flags.where($this).anyFalse()')).toEqual([false]);
    expect(evaluate(input, 'missing.allFalse()')).toEqual([true]);
  });

  it.each([
    "'true'",
    '1',
    '1.0',
    '@2020',
    '1.combine(true)',
    "true.combine('a')",
    'false.combine(0)',
  ])(
    'raises eval/type-mismatch for an item of %s that is not a Boolean, whatever the other items',
    (input) => {
      for (const name of ['allTrue', 'anyTrue', 'allFalse', 'anyFalse']) {
        expect(() => evaluate(null, `${input}.${name}()`)).toThrow(
          expect.objectContaining({ code: 'eval/type-mismatch' }),
        );
      }
    },
  );

  it('raises eval/type-mismatch for input objects', () => {
    expect(() => evaluate(patient, 'name.allTrue()')).toThrow(
      expect.objectContaining({ code: 'eval/type-mismatch' }),
    );
  });
});

// N1 §5.1.8–5.1.9, as 3.0.0 clarifies: an item is a member when = is true for an item of the
// other collection; false and empty both mean it is not.
// https://hl7.org/fhirpath/N1/#subsetofother-collection-boolean
// https://hl7.org/fhirpath/N1/#supersetofother-collection-boolean
// https://hl7.org/fhirpath/STU3/en/index.html#subsetofother--collection--boolean
describe('subsetOf and supersetOf', () => {
  const tag = (code: string): { system: string; code: string } => ({
    system: 'http://example.org/tags',
    code,
  });
  const medicationRequest = Object.freeze({
    resourceType: 'MedicationRequest',
    meta: { tag: [tag('a'), tag('b')] },
    contained: [{ resourceType: 'Medication', meta: { tag: [tag('a')] } }],
  });

  it.each([
    ['MedicationRequest.contained.meta.tag.subsetOf(MedicationRequest.meta.tag)', true], // N1
    ['MedicationRequest.contained.meta.tag.supersetOf(MedicationRequest.meta.tag)', false], // N1
    ['MedicationRequest.meta.tag.supersetOf(MedicationRequest.contained.meta.tag)', true],
    ['MedicationRequest.meta.tag.subsetOf(MedicationRequest.contained.meta.tag)', false],
    ['MedicationRequest.meta.tag.subsetOf(MedicationRequest.meta.tag)', true],
  ] as const)('%s', (expression, expected) => {
    expect(evaluate(medicationRequest, expression)).toEqual([expected]);
  });

  it.each([
    ['{}.subsetOf({})', true],
    ['{}.subsetOf(1)', true],
    ['1.subsetOf({})', false],
    ['{}.supersetOf({})', true],
    ['1.supersetOf({})', true],
    ['{}.supersetOf(1)', false],
    ['(1 | 2).subsetOf(3 | 2 | 1)', true],
    ['(1 | 4).subsetOf(3 | 2 | 1)', false],
    ['(3 | 2 | 1).supersetOf(1 | 2)', true],
    ['1.combine(1).subsetOf(1)', true],
    ['1.supersetOf(1.combine(1))', true],
    ['1.subsetOf(1.0)', true],
    ["'a'.subsetOf('A')", false],
    ["1 'h'.subsetOf(60 'min')", true],
    // Undetermined equality is not membership, as for intersect(); a later definite match is.
    ['@2020-01.subsetOf(@2020)', false],
    ['@2020.supersetOf(@2020-01)', false],
    ['@2020-01.subsetOf(@2020 | @2020-01)', true],
  ] as const)('%s', (expression, expected) => {
    expect(evaluate(null, expression)).toEqual([expected]);
  });

  it('evaluates other with the focus of the call (testSubSetOf1, testSubSetOf2)', () => {
    expect(evaluate(patient, 'Patient.name.first().subsetOf($this.name)')).toEqual([true]);
    expect(evaluate(patient, 'Patient.name.subsetOf($this.name.first())')).toEqual([false]);
    expect(evaluate(patient, 'Patient.name.supersetOf($this.name.first())')).toEqual([true]);
    expect(evaluate(patient, 'name.where(subsetOf(%names))', { variables: { names: [] } })).toEqual(
      [],
    );
  });
});

// N1 §5.1.11–5.1.12 with the 3.0.0 examples. The order of distinct() is open in the spec; the HL7
// tests keep the last of equal items (testDistinct30–35), and expect empty when the equality of
// two items is undetermined (testDistinct29, testDistinct36). docs/spec-notes.md#distinct-and-isdistinct
// https://hl7.org/fhirpath/N1/#distinct-collection
// https://hl7.org/fhirpath/N1/#isdistinct-boolean
// https://hl7.org/fhirpath/STU3/en/index.html#isdistinct--boolean
describe('distinct and isDistinct', () => {
  it('lists the distinct tags of a Patient, the last of equal ones (N1 example)', () => {
    const tags = Object.freeze([
      { system: 'http://example.org/tags', code: 'a' },
      { system: 'http://example.org/tags', code: 'b' },
      { code: 'a', system: 'http://example.org/tags' },
    ]);
    const tagged = { resourceType: 'Patient', meta: { tag: tags } };
    const result = evaluate(tagged, 'Patient.meta.tag.distinct()');
    expect(result).toEqual([tags[1], tags[2]]);
    expect(result[0]).toBe(tags[1]);
    expect(result[1]).toBe(tags[2]);
    expect(evaluate(tagged, 'Patient.meta.tag.isDistinct()')).toEqual([false]);
    expect(tags).toHaveLength(3);
  });

  it.each([
    ['1.combine(2).combine(3).isDistinct()', true], // 3.0.0 example
    ['1.combine(2).combine(3).combine(2).isDistinct()', false], // 3.0.0 example
    // 3.0.0 compares 1 'm' and 100 'cm'; the minimal unit system converts only time units.
    ["1 'h'.combine(60 'min').isDistinct()", false],
    ["1 'h'.combine(2 'h').isDistinct()", true],
    ['{}.isDistinct()', true],
    ['1.isDistinct()', true],
    ["'a'.combine('A').isDistinct()", true],
    ['1.combine(1.0).isDistinct()', false],
    ['Patient.name.isDistinct()', true],
    ['Patient.name.combine(Patient.name).isDistinct()', false],
  ] as const)('%s', (expression, expected) => {
    expect(evaluate(patient, expression)).toEqual([expected]);
  });

  it.each([
    ['{}.distinct()', []],
    ['1.distinct()', [1]],
    ["'a'.combine('b').combine('a').distinct()", ['b', 'a']], // testDistinct30
    ['1.combine(2).combine(1).combine(3).distinct()', [2, 1, 3]], // testDistinct32
    ['1.combine(2).combine(1.0).distinct()', [2, '1.0']], // testDistinct33
    ['true.combine(false).combine(true).distinct()', [false, true]], // testDistinct34
    ["'a'.combine('A').distinct()", ['a', 'A']],
    ["1 'h'.combine(60 'min').distinct().toString()", ["60 'min'"]],
  ] as const)('%s', (expression, expected) => {
    expect(evaluate(null, expression, { decimalOutput: 'string' })).toEqual(expected);
  });

  it('returns the input items themselves, and the input when nothing repeats', () => {
    const rows = Object.freeze([{ x: 1 }, { x: 2 }, { x: 1 }]);
    const input = { rows };
    const distinct = evaluate(input, 'rows.distinct()');
    expect(distinct).toEqual([{ x: 2 }, { x: 1 }]);
    expect(distinct[0]).toBe(rows[1]);
    expect(distinct[1]).toBe(rows[2]);
    expect(evaluate(input, 'rows.take(2).distinct()')).toEqual([rows[0], rows[1]]);
    expect(rows).toHaveLength(3);
  });

  it.each([
    '@2020.combine(@2020-01-01)', // testDistinct29, testDistinct36
    '@2020-01-01.combine(@2020)',
    '@2020.combine(1).combine(@2020-01)',
    '1.combine(1).combine(@2020).combine(@2020-01)',
    "1 'h'.combine(1 'kg')",
  ])('is empty for %s: the equality of two items is undetermined', (input) => {
    expect(evaluate(null, `${input}.distinct()`)).toEqual([]);
    expect(evaluate(null, `${input}.isDistinct()`)).toEqual([]);
  });

  it('reads an input string as a date only next to a date literal', () => {
    const input = { d: ['2020-01-01', '2020-01'] };
    expect(evaluate(input, 'd.isDistinct()')).toEqual([true]);
    expect(evaluate(input, 'd.first().combine(@2020-01-01).isDistinct()')).toEqual([false]);
    expect(evaluate(input, 'd.first().combine(@2020-01).isDistinct()')).toEqual([]);
  });
});

describe('arity of the existence functions', () => {
  it.each([
    'empty(1)',
    'all()',
    'all(true, false)',
    'allTrue(true)',
    'anyTrue(true)',
    'allFalse(true)',
    'anyFalse(true)',
    'subsetOf()',
    'subsetOf(1, 2)',
    'supersetOf()',
    'distinct(1)',
    'isDistinct(1)',
  ])('rejects %s at compile time', (expression) => {
    expect(() => compile(expression)).toThrow(
      expect.objectContaining({ code: 'semantic/wrong-arity' }),
    );
  });

  it('still checks the criterion of all() at compile time even on empty input', () => {
    expect(() => compile('{}.all(intentionallyMissingFunction())')).toThrow(
      expect.objectContaining({ code: 'semantic/unknown-function' }),
    );
  });
});

// ADR-0004: all() runs its criterion through the same internal sync/async path as exists().
describe('all on the internal sync and async lambda paths', () => {
  it.each(['sync', 'promise', 'custom thenable', 'cross-realm promise'] as const)(
    'stops after the first %s criterion that does not match',
    async (mode) => {
      const seen: string[] = [];
      const predicate = hostFunction('criterion', (items) => {
        const value = String(items[0]);
        seen.push(value);
        const result: Collection = [value !== '2'];
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
      const options = { functions: testRegistry(predicate) };
      const expression = '(1 | 2 | 3).all(criterion())';
      if (mode === 'sync') expect(evaluateInternal({}, expression, options)).toEqual([false]);
      else
        expect(() => evaluateInternal({}, expression, options)).toThrow(
          expect.objectContaining({ code: 'eval/async-in-sync' }),
        );
      seen.length = 0;
      expect(await evaluateAsync({}, expression, options)).toEqual([false]);
      expect(seen).toEqual(['1', '2']);
    },
  );

  it('continues after a sync-to-async transition with the right indices', async () => {
    const events: string[] = [];
    const predicate = hostFunction('criterion', (items) => {
      const value = String(items[0]);
      events.push(value);
      if (value === '1') return [true];
      if (value === '2') return customThenable([true]);
      if (value === '3') return Promise.resolve([false]);
      throw new Error('must not visit the fourth item');
    });
    expect(
      await evaluateAsync({}, '(1 | 2 | 3 | 4).all(criterion())', {
        functions: testRegistry(predicate),
      }),
    ).toEqual([false]);
    expect(events).toEqual(['1', '2', '3']);
    expect(
      await evaluateAsync({}, '(1 | 2 | 3).all($this.testThenable() < 4 and $index < 3)', {
        functions: testRegistry(),
      }),
    ).toEqual([true]);
  });

  it('propagates rejection and multi-item errors before a non-match, without later calls', async () => {
    const failure = new Error('criterion failed');
    let calls = 0;
    const predicate = hostFunction('criterion', () => {
      calls++;
      return Promise.reject(failure);
    });
    await expect(
      evaluateAsync({}, '(1 | 2).all(criterion())', { functions: testRegistry(predicate) }),
    ).rejects.toBe(failure);
    expect(calls).toBe(1);
    const invalid = hostFunction('criterion', () => customThenable([true, false]));
    await expect(
      evaluateAsync({}, '1.all(criterion())', { functions: testRegistry(invalid) }),
    ).rejects.toMatchObject({ code: 'eval/singleton-expected' });
  });

  it('isolates nested frames and concurrent evaluations of a compiled expression', async () => {
    const compiled = compileInternal(
      'groups.all(values.all($this.testThenable() != %target or $index = 0) and $index < 2)',
      { functions: testRegistry() },
    );
    const input = { groups: [{ values: [1, 2] }, { values: [1, 3] }] };
    expect(
      await Promise.all([
        compiled.evaluateAsync(input, { variables: { target: 2 } }),
        compiled.evaluateAsync(input, { variables: { target: 1 } }),
      ]),
    ).toEqual([[false], [true]]);
  });
});
