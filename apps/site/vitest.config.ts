import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'site',
    include: ['progress/**/*.test.ts', 'app/**/*.test.{ts,tsx}'],
  },
});
