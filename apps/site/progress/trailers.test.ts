import { describe, expect, it } from 'vitest';

import { parseTaskLines, splitSubject } from './trailers.ts';

describe('parseTaskLines', () => {
  it('reads the Task line of a squash commit body', () => {
    expect(parseTaskLines('Task: T0001\n\n## Summary\n\nAdds the lexer.')).toEqual(['T0001']);
  });

  it('ignores Task: none', () => {
    expect(parseTaskLines('Task: none\n\n## Summary')).toEqual([]);
  });

  it('reads split task IDs such as T0008a', () => {
    expect(parseTaskLines('Task: T0008a')).toEqual(['T0008a']);
  });

  it('names a task once, however many lines name it', () => {
    expect(parseTaskLines('Task: T0004\n\nTask: T0004')).toEqual(['T0004']);
  });

  it('only reads lines that start with Task:', () => {
    expect(parseTaskLines('Follow-up of Task: T0001 and T0002.\n- Task: T0003')).toEqual([]);
  });
});

describe('splitSubject', () => {
  it('splits the PR number off a squash commit subject', () => {
    expect(splitSubject('feat(core): add lexer (#11)')).toEqual({
      subject: 'feat(core): add lexer',
      pr: 11,
    });
  });

  it('keeps a subject without a PR number', () => {
    expect(splitSubject('initial commit')).toEqual({ subject: 'initial commit', pr: null });
  });
});
