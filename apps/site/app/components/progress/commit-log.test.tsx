import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { CommitPoint } from '../../../progress/types.ts';
import { CommitLog } from './commit-log.tsx';

const hostile: CommitPoint = {
  sha: '0123456789abcdef',
  date: '2026-11-05',
  subject: '</script><img src=x onerror=alert(1)> & <b>bold</b>',
  pr: 7,
  tasks: ['T0001'],
  conformance: null,
  testCases: 1234,
  testFiles: 2,
  sourceLines: 5678,
};

describe('CommitLog', () => {
  const html = renderToStaticMarkup(
    <CommitLog commits={[hostile]} suite="r4" active={0} onSelect={() => undefined} />,
  );

  it('renders a commit subject as text, never as markup', () => {
    expect(html).not.toContain('<img');
    expect(html).not.toContain('</script>');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain(
      '&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt; &amp; &lt;b&gt;bold&lt;/b&gt;',
    );
  });

  it('shows the numbers of the commit', () => {
    expect(html).toContain('#7');
    expect(html).toContain('0123456');
    expect(html).toContain('1,234');
    expect(html).toContain('5,678');
    expect(html).toContain('T0001');
  });
});
