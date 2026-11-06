import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    alias: [
      {
        find: /^@callis\/core$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    name: 'core',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
