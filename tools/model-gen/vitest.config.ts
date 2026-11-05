import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'model-gen', include: ['src/**/*.test.ts'] },
});
