import { defineProject } from 'vitest/config';

// Unit tests of the runner itself. They are part of `pnpm test`.
export default defineProject({
  test: {
    name: 'conformance',
    include: ['src/**/*.test.ts'],
  },
});
