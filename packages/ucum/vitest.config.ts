import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    // Tests run before the build, so they use core's source instead of its `dist`.
    alias: [
      {
        find: /^@callis\/core$/,
        replacement: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    name: 'ucum',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
