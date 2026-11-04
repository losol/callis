import type { EvaluatorAdapter } from './adapter.ts';
import { stubAdapter } from './stub-adapter.ts';

/**
 * The adapter that `pnpm conformance` and `pnpm test:conformance` use.
 *
 * This is the only file to change to plug in the engine: T0008 replaces the stub with an adapter
 * over the engine's internal `compile()`/`evaluate()`, and T0025 switches it to the public API.
 * See `tools/conformance/README.md` for the contract.
 */
export const engineAdapter: EvaluatorAdapter = stubAdapter;
