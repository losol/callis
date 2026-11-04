import { describe, expect, it } from 'vitest';
import {
  checkRoadmap,
  issueBody,
  issueLabels,
  issueTitle,
  loadRoadmap,
  parseRoadmap,
  projectFieldValues,
  type RoadmapTask,
  setDiff,
  taskIdOfIssueTitle,
} from './roadmap.ts';

// The rules come from CONTRIBUTING.md, "Roadmap sync".

interface FixtureTask {
  id: string;
  title: string;
  file: string;
  wave: string;
  deps: string[];
}

const LEXER: FixtureTask = {
  id: 'T0001',
  title: 'Lexer',
  file: 'T0001-lexer.md',
  wave: '1',
  deps: [],
};

const TASKS: FixtureTask[] = [
  LEXER,
  { id: 'T0002', title: 'Parser', file: 'T0002-parser.md', wave: '2', deps: ['T0001'] },
  { id: 'T0002a', title: 'Parser, part two', file: 'T0002a-parser.md', wave: '2', deps: ['T0001'] },
  {
    id: 'T0003',
    title: '`Long` type',
    file: 'T0003-long.md',
    wave: '3',
    deps: ['T0002', 'T0002a'],
  },
];

function roadmapMarkdown(tasks: FixtureTask[] = TASKS): string {
  const rows = tasks.map(
    (t) =>
      `| [${t.id}](tasks/${t.file}) | ${t.title} | 1 | ${t.deps.length === 0 ? '–' : t.deps.join(', ')} | ${t.wave} | M |`,
  );
  return [
    '# Roadmap',
    '',
    '## Overview',
    '',
    '| ID | Task | Phase | Depends on | Wave | Size |',
    '| --- | --- | --- | --- | :---: | :---: |',
    ...rows,
    '',
    '## Dependency graph',
    '',
    '```mermaid',
    'flowchart TD',
    '  T0001["T0001 Lexer"]',
    '  T0001 --> T0002 & T0002a',
    '  T0002 & T0002a --> T0003',
    '```',
    '',
    '## Waves (suggested order)',
    '',
    '| Wave | Tasks | Parallel workers | Notes |',
    '| :---: | --- | :---: | --- |',
    '| 1 | T0001 | 1 | |',
    '| 2 | T0002–T0002a | 2 | A range. |',
    '| 3 | T0003 | 1 | |',
    '',
    '## Backlog (not scheduled)',
    '',
  ].join('\n');
}

function taskFile(t: FixtureTask): string {
  const deps = t.deps.length === 0 ? '–' : t.deps.map((d) => `[${d}](${d}-x.md)`).join(', ');
  return [
    `# ${t.id} — ${t.title}`,
    '',
    `Part of the [roadmap](../roadmap.md). Phase 1 · wave ${t.wave} · size M.`,
    '',
    `- **Depends on:** ${deps}`,
    '',
  ].join('\n');
}

function taskFiles(tasks: FixtureTask[] = TASKS): Map<string, string> {
  return new Map(tasks.map((t) => [`tasks/${t.file}`, taskFile(t)]));
}

function problemsFor(markdown: string, files = taskFiles()): string {
  return checkRoadmap(parseRoadmap(markdown), files).join('\n');
}

describe('parseRoadmap', () => {
  it('reads the overview, the graph and the waves table', () => {
    const roadmap = parseRoadmap(roadmapMarkdown());
    expect(roadmap.problems).toEqual([]);
    expect(roadmap.tasks[3]).toEqual({
      id: 'T0003',
      title: '`Long` type',
      file: 'tasks/T0003-long.md',
      phase: '1',
      wave: '3',
      size: 'M',
      dependsOn: ['T0002', 'T0002a'],
    });
    expect(roadmap.graphEdges).toContainEqual(['T0002a', 'T0003']);
    expect(roadmap.waves.get('2')).toEqual(['T0002', 'T0002a']);
  });

  it('reports rows it cannot read', () => {
    const markdown = roadmapMarkdown().replace('| Lexer | 1 | – | 1 | M |', '| Lexer | 1 |');
    expect(parseRoadmap(markdown).problems.join('\n')).toContain('cannot read the row');
  });
});

describe('checkRoadmap', () => {
  it('accepts a consistent roadmap', () => {
    expect(problemsFor(roadmapMarkdown())).toBe('');
  });

  it('accepts the roadmap in this repository', () => {
    expect(loadRoadmap(new URL('..', import.meta.url).pathname).problems).toEqual([]);
  });

  it.each([
    [
      'a missing graph edge',
      (m: string) => m.replace('T0002 & T0002a --> T0003', 'T0002 --> T0003'),
      'T0003: the graph draws T0002',
    ],
    [
      'an unknown graph task',
      (m: string) => m.replace('```\n\n## Waves', '  T0009 --> T0003\n```\n\n## Waves'),
      'names a task that is not in the overview',
    ],
    [
      'a wave table mismatch',
      (m: string) => m.replace('| 3 | T0003 |', '| 3 | T0001 |'),
      'Waves: wave 3 lists T0001',
    ],
    [
      'an unknown size',
      (m: string) => m.replace('| 1 | M |', '| 1 | XL |'),
      'size must be S, M or L',
    ],
  ])('reports %s', (_name, edit, problem) => {
    expect(problemsFor(edit(roadmapMarkdown()))).toContain(problem);
  });

  it('reports a dependency that is not in the overview', () => {
    const tasks = TASKS.map((t) => (t.id === 'T0001' ? { ...t, deps: ['T0099'] } : t));
    expect(problemsFor(roadmapMarkdown(tasks), taskFiles(tasks))).toContain(
      'T0001: depends on T0099, which is not in the overview',
    );
  });

  it('reports a task that is not in a later wave than its dependency', () => {
    const tasks = TASKS.map((t) => (t.id === 'T0003' ? { ...t, wave: '2' } : t));
    const markdown = roadmapMarkdown(tasks).replace('| 3 | T0003 |', '| 2 | T0003 |');
    expect(problemsFor(markdown, taskFiles(tasks))).toContain(
      'T0003: is in wave 2 but depends on T0002 in wave 2',
    );
  });

  it('reports duplicate IDs', () => {
    expect(problemsFor(roadmapMarkdown([...TASKS, LEXER]))).toContain(
      'T0001: listed more than once',
    );
  });

  it('reports task files that disagree with the roadmap', () => {
    const files = taskFiles();
    files.set(
      'tasks/T0001-lexer.md',
      '# T0001 — Lexing\n\nPart of the [roadmap](../roadmap.md). Phase 1 · wave 2 · size M.\n',
    );
    files.set(
      'tasks/T0003-long.md',
      taskFile({ id: 'T0003', title: '`Long` type', file: '', wave: '3', deps: ['T0002'] }),
    );
    const problems = problemsFor(roadmapMarkdown(), files);
    expect(problems).toContain('T0001-lexer.md: the first line should be "# T0001 — Lexer"');
    expect(problems).toContain('should end with "Phase 1 · wave 1 · size M."');
    expect(problems).toContain('T0001-lexer.md: no "- **Depends on:**" line');
    expect(problems).toContain('depends on T0002, but the roadmap says T0002, T0002a');
  });

  it('reports missing and unlisted task files', () => {
    const files = taskFiles();
    files.delete('tasks/T0002-parser.md');
    files.set('tasks/T0004-extra.md', '');
    const problems = problemsFor(roadmapMarkdown(), files);
    expect(problems).toContain('T0002: the task file docs/tasks/T0002-parser.md does not exist');
    expect(problems).toContain('docs/tasks/T0004-extra.md: not listed in the roadmap overview');
  });
});

const TASK: RoadmapTask = {
  id: 'T0002',
  title: 'Parser and AST',
  file: 'tasks/T0002-parser.md',
  phase: '1',
  wave: '2',
  size: 'M',
  dependsOn: ['T0001'],
};

describe('task issues', () => {
  it('titles issues with the task ID and finds the ID again', () => {
    expect(issueTitle(TASK)).toBe('T0002: Parser and AST');
    expect(taskIdOfIssueTitle('T0002: Parser and AST')).toBe('T0002');
    expect(taskIdOfIssueTitle('T0008a: Compiler, part one')).toBe('T0008a');
    expect(taskIdOfIssueTitle('Fix T0002 parser')).toBeUndefined();
  });

  it('replaces the wave label and keeps other labels', () => {
    expect(issueLabels(TASK, ['wave-1', 'task', 'help wanted'])).toEqual([
      'task',
      'wave-2',
      'help wanted',
    ]);
  });

  it('links the task file in a new issue body', () => {
    expect(issueBody(TASK)).toContain(
      '[`docs/tasks/T0002-parser.md`](https://github.com/losol/callis/blob/main/docs/tasks/T0002-parser.md)',
    );
    expect(issueBody(TASK)).toContain('`Task: T0002`');
  });

  it('sets the project fields from the roadmap', () => {
    expect(projectFieldValues(TASK)).toEqual({
      Task: 'T0002',
      Phase: '1',
      Wave: '2',
      Size: 'M',
      'Depends on': 'T0001',
    });
    expect(projectFieldValues({ ...TASK, dependsOn: [] })['Depends on']).toBe('–');
  });

  it('computes the changes between two sets', () => {
    expect(setDiff([1, 2, 3], [2, 3, 4])).toEqual({ add: [4], remove: [1] });
  });
});
