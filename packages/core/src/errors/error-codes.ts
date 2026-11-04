/**
 * Stable error codes, grouped by the stage that raises them.
 *
 * Codes are part of the public contract: programs and tests match on them. Messages are for
 * people and may change. Tasks add codes here as they need them.
 */

/** Raised while lexing and parsing an expression. */
export type SyntaxErrorCode =
  | 'syntax/unexpected-token'
  | 'syntax/unexpected-character'
  | 'syntax/unterminated-string'
  | 'syntax/invalid-escape'
  | 'syntax/invalid-date-literal';

/** Raised by compile-time checks, before evaluation starts. */
export type SemanticErrorCode =
  | 'semantic/unknown-function'
  | 'semantic/wrong-arity'
  | 'semantic/unknown-element'
  | 'semantic/unknown-type';

/** Raised while an expression is evaluated. */
export type EvaluationErrorCode =
  | 'eval/singleton-expected'
  | 'eval/type-mismatch'
  | 'eval/undefined-variable'
  | 'eval/invalid-literal'
  | 'eval/invalid-argument'
  | 'eval/async-in-sync'
  | 'eval/aborted'
  | 'eval/limit-exceeded'
  | 'eval/datetime-out-of-range'
  | 'eval/invalid-calendar-unit';

/** Every stable error code. */
export type ErrorCode = SyntaxErrorCode | SemanticErrorCode | EvaluationErrorCode;
