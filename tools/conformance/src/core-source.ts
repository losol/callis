/**
 * Resolves `@callis/core` to core's source in the runner's process. `pnpm conformance` preloads
 * this file with `node --import`, before the adapter is loaded.
 *
 * The adapter runs the engine from source, and so does `@callis/ucum`, whose source imports
 * `@callis/core`. That package exports only its build, so without this the runner would need a
 * build first and would load a second copy of core, whose values are not the engine's classes.
 * Vitest does the same with an alias (`vitest.config.ts`, `vitest.suite.config.ts`).
 */
import { registerHooks } from 'node:module';

const CORE_SOURCE = new URL('../../../packages/core/src/index.ts', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@callis/core') {
      return { url: CORE_SOURCE, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
