import { defineConfig } from 'tsdown';

export default defineConfig({
  // The UCUM essence text is its own entry, so the bundle keeps it in a separate file under the
  // UCUM notice, apart from the MIT-licensed code that reads it.
  entry: ['src/index.ts', 'src/essence/ucum-essence-xml.ts'],
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
});
