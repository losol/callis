import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// The browser tests must test the build of this checkout. On a fixed port that reused a running
// server, a run in one worktree could find the preview server of another and silently test that
// build instead (#165). The preview server sends the built files unchanged, and the home page
// names the hashed assets of its build.
test('serves the build of this checkout', async ({ request }) => {
  const response = await request.get('/');
  expect(response.ok()).toBe(true);
  expect(await response.text()).toBe(
    readFileSync(new URL('../../build/client/index.html', import.meta.url), 'utf8'),
  );
});
