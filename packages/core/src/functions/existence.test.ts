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
