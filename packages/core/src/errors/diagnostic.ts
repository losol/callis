import type { ErrorCode } from './error-codes.ts';
import type { SourceSpan } from './source-span.ts';

/**
 * A problem found by static analysis. Errors stop compilation; warnings do not
 * ([T0024](https://github.com/losol/callis/blob/main/docs/tasks/T0024-static-analysis.md)).
 */
export interface Diagnostic {
  readonly severity: 'error' | 'warning';
  /** Stable, for programs; the syntax codes appear only in the result of `analyze()`. */
  readonly code: ErrorCode;
  /** For people; it may change. */
  readonly message: string;
  /** Where in the expression the problem is. Absent for a problem with the options. */
  readonly span?: SourceSpan;
  /** A suggested rewrite, such as `value.ofType(Quantity)` for `valueQuantity`. */
  readonly hint?: string;
}
