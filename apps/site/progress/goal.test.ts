import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { extractGoal } from './goal.ts';

describe('extractGoal', () => {
  it('reads the paragraphs of the Goal section only', () => {
    const markdown = [
      '# T0001 — Lexer',
      '',
      '## Goal',
      '',
      'Turn an expression string',
      'into tokens.',
      '',
      'A second paragraph.',
      '',
      '## Scope',
      '',
      'Not part of the goal.',
    ].join('\n');
    expect(extractGoal(markdown)).toEqual([
      { kind: 'paragraph', text: 'Turn an expression string into tokens.' },
      { kind: 'paragraph', text: 'A second paragraph.' },
    ]);
  });

  it('reads list items, flattening nested ones and joining continued lines', () => {
    const markdown = [
      '## Goal',
      '',
      'Functions:',
      '- `iif` (lazy)',
      '  - nested',
      '    continued',
      '1. ordered',
    ].join('\n');
    expect(extractGoal(markdown)).toEqual([
      { kind: 'paragraph', text: 'Functions:' },
      { kind: 'item', text: '`iif` (lazy)' },
      { kind: 'item', text: 'nested continued' },
      { kind: 'item', text: 'ordered' },
    ]);
  });

  it('reduces links to their text and keeps code spans', () => {
    const markdown = [
      '## Goal',
      '',
      '[N1 §5.1](https://hl7.org/fhirpath/N1/#existence): `exists([criteria])`, [`Decimal`](../adr/0005.md), **all** at <https://callis.losol.no>.',
      '`[not](a link)` stays code.',
    ].join('\n');
    expect(extractGoal(markdown)).toEqual([
      {
        kind: 'paragraph',
        text: 'N1 §5.1: `exists([criteria])`, `Decimal`, all at https://callis.losol.no. `[not](a link)` stays code.',
      },
    ]);
  });

  it('is empty without a Goal section', () => {
    expect(extractGoal('# T0099 — Nothing\n\n## Scope\n\nText.\n')).toEqual([]);
  });

  it('reads a goal from every task file, without link syntax', () => {
    const tasksDir = new URL('../../../docs/tasks/', import.meta.url);
    const files = readdirSync(tasksDir).filter((file) => /^T\d{4}[a-z]?-.+\.md$/.test(file));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const goal = extractGoal(readFileSync(new URL(file, tasksDir), 'utf8'));
      expect(goal.length, file).toBeGreaterThan(0);
      for (const block of goal) {
        expect(block.text.replace(/`[^`]*`/g, ''), file).not.toMatch(/\]\(|<https?:/);
      }
    }
  });
});
