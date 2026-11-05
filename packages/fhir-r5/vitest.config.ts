import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'fhir-r5',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
