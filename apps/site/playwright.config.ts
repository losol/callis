import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig } from '@playwright/test';

/** A port on 127.0.0.1 that nothing listens on at the moment. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address !== null && typeof address === 'object') {
          resolve(address.port);
        } else {
          reject(new Error('The system did not assign a port.'));
        }
      });
    });
  });
}

// Every run serves its own build on a port of its own, so runs in two worktrees at the same time
// never test each other's build. The runner picks the port once and leaves it in the environment;
// the workers it starts inherit the environment and load this file with the same port. Set
// CALLIS_SITE_TEST_PORT to choose the port yourself.
process.env.CALLIS_SITE_TEST_PORT ??= String(await freePort());
const port = process.env.CALLIS_SITE_TEST_PORT;
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './test/browser',
  outputDir: join(tmpdir(), `callis-site-${process.env.AO_SESSION_ID ?? 'ci'}`),
  use: { baseURL: origin },
  webServer: {
    command: `pnpm exec vite preview --config test/browser/preview.config.ts --host 127.0.0.1 --port ${port} --strictPort --outDir build/client`,
    url: `${origin}/playground/`,
    // A server that already listens on the port is not this run's: fail rather than test it.
    reuseExistingServer: false,
  },
});
