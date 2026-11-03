import type { ErrorCode } from './error-codes.ts';
import type { SourceSpan } from './source-span.ts';

/** A problem found by static analysis. Errors stop compilation; warnings do not. */
export interface Diagnostic {
  readonly severity: 'error' | 'warning';
  readonly code: ErrorCode;
  readonly message: string;
  readonly span?: SourceSpan;
}
