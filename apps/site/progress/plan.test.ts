import { describe, expect, it } from 'vitest';

import { buildPlan } from './plan.ts';

const roadmap = `# Roadmap

## Overview

| ID | Task | Phase | Depends on | Wave | Size |
| --- | --- | --- | --- | :---: | :---: |
| [T0000](tasks/T0000-scaffold.md) | Repository scaffold | 0 | – | 0 | M |
| [T0001](tasks/T0001-lexer.md) | Lexer | 1 | T0000 | 1 | M |
| [T0011](tasks/T0011-fn-existence.md) | Functions: existence | 1 | T0000, T0001 | 4 | S |

## Waves (suggested order)
`;

const files: Record<string, string> = {
  'tasks/T0011-fn-existence.md':
    '## Goal\n\n[N1 §5.1](https://hl7.org/fhirpath/N1/#existence): `empty`, `exists([criteria])`.\n',
};

describe('buildPlan', () => {
  const commits = [{ tasks: [] }, { tasks: ['T0000'] }, { tasks: ['T0001', 'T0000'] }];
  const plan = buildPlan(roadmap, (file) => files[file] ?? '', commits);

  it('reads the tasks of the roadmap', () => {
    expect(plan.map((task) => [task.id, task.title, task.phase, task.wave, task.size])).toEqual([
      ['T0000', 'Repository scaffold', 0, 0, 'M'],
      ['T0001', 'Lexer', 1, 1, 'M'],
      ['T0011', 'Functions: existence', 1, 4, 'S'],
    ]);
    expect(plan[2]?.deps).toEqual(['T0000', 'T0001']);
    expect(plan[0]?.deps).toEqual([]);
  });

  it('merges a task at the first commit that names it', () => {
    expect(plan.map((task) => task.doneAt)).toEqual([1, 2, null]);
  });

  it('reads the functions from the task file', () => {
    expect(plan[2]?.items.map((item) => item.name)).toEqual(['empty', 'exists']);
    expect(plan[1]?.items).toEqual([]);
  });

  it('keeps the path of the task file and reads its goal', () => {
    expect(plan[2]?.file).toBe('tasks/T0011-fn-existence.md');
    expect(plan[2]?.goal).toEqual([
      { kind: 'paragraph', text: 'N1 §5.1: `empty`, `exists([criteria])`.' },
    ]);
    expect(plan[0]?.goal).toEqual([]);
  });
});
