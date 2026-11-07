import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { extractItems, ITEM_SOURCES, sectionLines } from './items.ts';
import { buildPlan } from './plan.ts';

const tasksDir = join(fileURLToPath(new URL('.', import.meta.url)), '../../../docs/tasks');

/** The task file of a task, by ID, from the repository. */
function taskFile(id: string): string {
  const name = readdirSync(tasksDir).find((file) => file.startsWith(`${id}-`));
  if (name === undefined) {
    throw new Error(`No task file for ${id}`);
  }
  return readFileSync(join(tasksDir, name), 'utf8');
}

describe('sectionLines', () => {
  it('returns the lines of one section, without the heading', () => {
    const markdown = '# T\n\n## Goal\n\none\ntwo\n\n## Scope\n\nthree';
    expect(sectionLines(markdown, 'Goal')).toEqual(['', 'one', 'two', '']);
  });
});

describe('extractItems', () => {
  it('reads the names in the Goal section, without arguments', () => {
    const markdown = '## Goal\n\n`exists([criteria])`, `all`, `count`.\n\n## Scope\n\n`ignored`';
    expect(extractItems('T0011', markdown)).toEqual([
      { kind: 'function', name: 'exists' },
      { kind: 'function', name: 'all' },
      { kind: 'function', name: 'count' },
    ]);
  });

  it('names a function once', () => {
    const markdown = '## Goal\n\n`abs`, `ceiling`. `abs` also supports Quantity.';
    expect(extractItems('T0016', markdown).map((item) => item.name)).toEqual(['abs', 'ceiling']);
  });

  it('returns nothing for a task without a list', () => {
    expect(extractItems('T0001', '## Goal\n\n`lexer`')).toEqual([]);
  });

  // The task files are prose, so the lists are pinned here: if a task file
  // changes its wording, this test says the page would show something else.
  describe('the task files of the repository', () => {
    const expected: Record<string, string[]> = {
      T0010: [
        '=',
        '~',
        '!=',
        '!~',
        '<',
        '>',
        '<=',
        '>=',
        '+',
        '-',
        '*',
        '/',
        'div',
        'mod',
        '&',
        '|',
        'in',
        'contains',
      ],
      T0011: ['exists', 'count'],
      T0012: ['where'],
      T0041: [
        'empty',
        'all',
        'allTrue',
        'anyTrue',
        'allFalse',
        'anyFalse',
        'subsetOf',
        'supersetOf',
        'distinct',
        'isDistinct',
      ],
      T0042: ['select', 'repeat', 'ofType'],
      T0013: [
        'single',
        'first',
        'last',
        'tail',
        'skip',
        'take',
        'intersect',
        'exclude',
        'union',
        'combine',
      ],
      T0014: [
        'iif',
        'toBoolean',
        'convertsToBoolean',
        'toInteger',
        'convertsToInteger',
        'toDecimal',
        'convertsToDecimal',
        'toDate',
        'convertsToDate',
        'toDateTime',
        'convertsToDateTime',
        'toTime',
        'convertsToTime',
        'toString',
        'convertsToString',
        'toQuantity',
        'convertsToQuantity',
      ],
      T0015: [
        'indexOf',
        'substring',
        'startsWith',
        'endsWith',
        'contains',
        'upper',
        'lower',
        'replace',
        'matches',
        'replaceMatches',
        'length',
        'toChars',
      ],
      T0016: ['abs', 'ceiling', 'exp', 'floor', 'ln', 'log', 'power', 'round', 'sqrt', 'truncate'],
      T0017: ['children', 'descendants', 'trace', 'now', 'timeOfDay', 'today'],
      T0020: [
        'extension',
        'hasValue',
        'getValue',
        'resolve',
        'memberOf',
        'subsumes',
        'subsumedBy',
        'conformsTo',
        'htmlChecks',
      ],
    };

    it('preserves every original split function exactly once', () => {
      const original = [
        'empty',
        'exists',
        'all',
        'allTrue',
        'anyTrue',
        'allFalse',
        'anyFalse',
        'subsetOf',
        'supersetOf',
        'count',
        'distinct',
        'isDistinct',
        'where',
        'select',
        'repeat',
        'ofType',
      ];
      const actual = ['T0011', 'T0012', 'T0041', 'T0042'].flatMap((id) =>
        extractItems(id, taskFile(id)).map((item) => item.name),
      );
      expect(actual.toSorted()).toEqual(original.toSorted());
      expect(new Set(actual).size).toBe(original.length);
    });

    it('does not mark completion functions delivered with the reduced tasks', () => {
      const roadmap = readFileSync(join(tasksDir, '../roadmap.md'), 'utf8');
      const plan = buildPlan(roadmap, (file) => readFileSync(join(tasksDir, '..', file), 'utf8'), [
        { tasks: ['T0011', 'T0012'] },
      ]);
      expect(plan.find((task) => task.id === 'T0041')?.doneAt).toBeNull();
      expect(plan.find((task) => task.id === 'T0042')?.doneAt).toBeNull();
      expect(
        plan
          .filter((task) => task.doneAt !== null)
          .flatMap((task) => task.items.map((item) => item.name))
          .toSorted(),
      ).toEqual(['count', 'exists', 'where']);
    });

    it('has a pinned list for every task that has a source', () => {
      expect(Object.keys(ITEM_SOURCES).sort()).toEqual(Object.keys(expected).sort());
    });

    for (const [id, names] of Object.entries(expected)) {
      it(`reads the list of ${id}`, () => {
        expect(extractItems(id, taskFile(id)).map((item) => item.name)).toEqual(names);
      });
    }
  });
});
