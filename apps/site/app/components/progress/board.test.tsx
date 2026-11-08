import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { CommitPoint, PlanTask } from '../../../progress/types.ts';
import { Board, relationTo } from './board.tsx';
import { issueSearchUrl, TaskDrawer } from './task-drawer.tsx';

function task(id: string, deps: string[], doneAt: number | null, title = `Task ${id}`): PlanTask {
  return {
    id,
    title,
    file: `tasks/${id}-task.md`,
    phase: 1,
    deps,
    wave: deps.length,
    size: 'M',
    doneAt,
    items: [],
    goal: [],
  };
}

function commit(sha: string, pr: number | null): CommitPoint {
  return {
    sha,
    date: '2026-11-05',
    subject: 'subject',
    pr,
    tasks: [],
    conformance: null,
    testCases: 0,
    testFiles: 0,
    sourceLines: 0,
  };
}

// T1 is merged at commit 1 in #7; T2 depends on T1; T3 depends on T2 and on T404, which is
// not in the plan.
const plan = [task('T1', [], 1), task('T2', ['T1'], null), task('T3', ['T2', 'T404'], null)];
const commits = [commit('aaaaaaa0000', null), commit('bbbbbbb1111', 7)];

/** Renders with a router around it, for the `Link` to the task file. */
function render(element: ReactElement): string {
  const router = createMemoryRouter([{ path: '/', element }]);
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe('relationTo', () => {
  const [t1, t2, t3] = plan;

  it('tells the highlighted task from its dependencies and dependents', () => {
    expect(relationTo(t2, t2 as PlanTask)).toBe('current');
    expect(relationTo(t2, t1 as PlanTask)).toBe('dependency');
    expect(relationTo(t2, t3 as PlanTask)).toBe('dependent');
    expect(relationTo(t1, t3 as PlanTask)).toBeUndefined();
  });

  it('relates nothing when no task is highlighted', () => {
    expect(relationTo(undefined, t1 as PlanTask)).toBeUndefined();
  });
});

describe('Board', () => {
  const html = renderToStaticMarkup(<Board plan={plan} commits={commits} active={1} />);

  it('renders tiles that open a dialog, with their status as text and no native tooltip', () => {
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('title=');
    expect(html).toContain('(merged in #7)');
    expect(html).toContain('(unblocked)');
    expect(html).toContain('(blocked)');
  });

  it('renders no drawer and no selected tile until a task is chosen', () => {
    expect(html).not.toContain('pg-drawer');
    expect(html).not.toContain('aria-current');
  });
});

describe('TaskDrawer', () => {
  const props = {
    plan,
    commits,
    focusRequest: 1,
    onShow: () => undefined,
    onClose: () => undefined,
  };

  it('is a labelled, non-modal dialog with a close button', () => {
    const html = render(
      <TaskDrawer {...props} task={plan[1] as PlanTask} active={1} page={undefined} />,
    );
    expect(html).toMatch(/<section class="pg-drawer" role="dialog" aria-labelledby="([^"]+)">/);
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`<h2 id="${labelledBy}" tabindex="-1">`);
    expect(html).not.toContain('aria-modal');
    expect(html).toContain('<span class="pg-visually-hidden">Close</span>');
  });

  it('shows the facts, the status at the selected commit and both kinds of relation', () => {
    const html = render(
      <TaskDrawer
        {...props}
        task={plan[1] as PlanTask}
        active={1}
        page={{ href: '/tasks/T2-task', external: false }}
      />,
    );
    expect(html).toContain('Task T2');
    expect(html).toMatch(/<dt>Wave<\/dt><dd>1<\/dd>/);
    expect(html).toMatch(/<dt>Size<\/dt><dd>M<\/dd>/);
    expect(html).toContain('Unblocked');
    expect(html).toContain('at bbbbbbb: every dependency is merged.');
    expect(html).toContain('Depends on (1)');
    expect(html).toContain('Needed by (1)');
    expect(html).toMatch(/<button type="button" class="pg-relation done"/);
    expect(html).toMatch(/<button type="button" class="pg-relation blocked"/);
    expect(html).toContain('href="/tasks/T2-task"');
    expect(html).toContain(`href="${issueSearchUrl('T2').replaceAll('&', '&amp;')}"`);
  });

  it('names the dependencies a blocked task waits for, including unknown ones', () => {
    const html = render(
      <TaskDrawer {...props} task={plan[2] as PlanTask} active={1} page={undefined} />,
    );
    expect(html).toContain('at bbbbbbb: waiting for T2, T404.');
    expect(html).toContain('not in the roadmap');
    expect(html).toContain('No task depends on it.');
    expect(html).not.toContain('Task file');
  });

  it('links the pull request of a merged task and an external task file', () => {
    const html = render(
      <TaskDrawer
        {...props}
        task={plan[0] as PlanTask}
        active={1}
        page={{
          href: 'https://github.com/losol/callis/blob/main/docs/tasks/T1.md',
          external: true,
        }}
      />,
    );
    expect(html).toContain('in #7 on 2026-11-05.');
    expect(html).toContain('href="https://github.com/losol/callis/pull/7"');
    expect(html).toContain('Pull request #7');
    expect(html).toContain('Nothing: it can start at any time.');
    expect(html).toMatch(
      /href="https:\/\/github.com\/losol\/callis\/blob\/main\/docs\/tasks\/T1.md" target="_blank" rel="noopener noreferrer"/,
    );
  });

  it('renders the goal and titles as text, with code spans as code and never as markup', () => {
    const hostile = {
      ...task('T9', [], null, '`<b>bold</b>` & </script>'),
      goal: [
        { kind: 'paragraph' as const, text: 'Use `a < b` <img src=x onerror=alert(1)>.' },
        { kind: 'item' as const, text: 'one' },
        { kind: 'item' as const, text: 'one' },
      ],
    };
    const html = render(
      <TaskDrawer {...props} plan={[hostile]} task={hostile} active={0} page={undefined} />,
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('<code>&lt;b&gt;bold&lt;/b&gt;</code>');
    expect(html).toContain('<code>a &lt; b</code>');
    expect(html).toMatch(/<ul><li><span>one<\/span><\/li><li><span>one<\/span><\/li><\/ul>/);
  });

  it('builds the issue search from the task ID in the title', () => {
    const url = new URL(issueSearchUrl('T0009'));
    expect(url.origin + url.pathname).toBe('https://github.com/losol/callis/issues');
    expect(url.searchParams.get('q')).toBe('is:issue label:task in:title "T0009:"');
  });
});
