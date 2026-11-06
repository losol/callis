import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  // The public evaluator makes the parser and value kernels reachable; ship compact code while
  // retaining runtime names and source maps for error diagnostics.
  minify: { mangle: false },
  sourcemap: true,
  clean: true,
});
