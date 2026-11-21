import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    alias: [
      {
        find: /^@callis\/core$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
      // The documented examples import the providers that the engine's options take.
      ...['ucum', 'fhir-r4', 'fhir-r5', 'fhir-r6'].map((name) => ({
        find: new RegExp(`^@callis/${name}$`),
        replacement: fileURLToPath(new URL(`../${name}/src/index.ts`, import.meta.url)),
      })),
    ],
  },
  test: {
    name: 'core',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
