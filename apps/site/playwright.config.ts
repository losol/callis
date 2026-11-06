import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  outputDir: join(tmpdir(), `callis-site-${process.env.AO_SESSION_ID ?? 'ci'}`),
  use: { baseURL: 'http://127.0.0.1:4179' },
  webServer: {
    command:
      'pnpm exec vite preview --config test/browser/preview.config.ts --host 127.0.0.1 --port 4179 --strictPort --outDir build/client',
    url: 'http://127.0.0.1:4179/playground/',
    reuseExistingServer: !process.env.CI,
  },
});
