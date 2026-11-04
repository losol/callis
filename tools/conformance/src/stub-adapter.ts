import type { ClassifiedError, EvaluatorAdapter, ResultItem } from './adapter.ts';

/** Thrown by the {@link stubAdapter} for every evaluation. */
export class NotImplementedError extends Error {
  override readonly name: string = 'NotImplementedError';
}

/**
 * The adapter used until an engine exists. Every evaluation throws {@link NotImplementedError},
 * so each test that runs is reported as failing ("not implemented"); nothing crashes the runner.
 */
export const stubAdapter: EvaluatorAdapter = {
  name: 'stub (no engine yet)',
  evaluate(): never {
    throw new NotImplementedError('no engine yet');
  },
  describeValue(): ResultItem {
    return { type: 'unknown' };
  },
  classifyError(error: unknown): ClassifiedError {
    const message = error instanceof Error ? error.message : String(error);
    return {
      kind: error instanceof NotImplementedError ? 'not-implemented' : 'other',
      code: undefined,
      message,
    };
  },
};
