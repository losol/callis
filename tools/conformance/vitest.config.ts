import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

// Unit tests of the runner itself. They are part of `pnpm test`.
export default defineProject({
  resolve: {
    // The engine runs from source, and so does @callis/ucum: its `@callis/core` import is core's
    // source too, not a build (`src/core-source.ts` does the same for `pnpm conformance`).
    alias: [
      {
        find: /^@callis\/core$/,
        replacement: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    name: 'conformance',
    include: ['src/**/*.test.ts'],
  },
});
