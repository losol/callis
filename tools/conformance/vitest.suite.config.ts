import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The HL7 suite as one Vitest test per suite test, for per-test diffs. Run it with
// `pnpm test:conformance`; it is not part of `pnpm test`, because most suite tests fail until the
// engine is complete.
export default defineConfig({
  resolve: {
    // As in vitest.config.ts: @callis/ucum's `@callis/core` import is core's source.
    alias: [
      {
        find: /^@callis\/core$/,
        replacement: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    name: 'conformance-suite',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['suite/**/*.test.ts'],
  },
});
