import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'fhir-r6',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
