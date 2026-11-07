import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { customThenable, hostFunction, testRegistry } from '../../test/support/test-functions.ts';
import { evaluateAsync, evaluate as evaluateInternal } from '../api/compile.ts';
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
