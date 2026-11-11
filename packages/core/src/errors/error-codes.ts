/**
 * Stable error codes, grouped by the stage that raises them.
 *
 * Codes are part of the public contract: programs and tests match on them. Messages are for
 * people and may change. Tasks add codes here as they need them.
 */

/** Raised while lexing and parsing an expression. */
export type SyntaxErrorCode =
  | 'syntax/unexpected-token'
  | 'syntax/nesting-limit'
  | 'syntax/unexpected-character'
  | 'syntax/unterminated-string'
  | 'syntax/unterminated-comment'
  | 'syntax/invalid-escape'
  | 'syntax/invalid-date-literal';

/**
 * Raised by compile-time checks, before evaluation starts, and reported by static analysis
 * (T0024). `semantic/unknown-type` and `semantic/fraction-ignored` are warnings: they never stop
 * compilation. `semantic/singleton-expected` and `semantic/unordered-collection` are errors in
 * strict mode only ([N1 §11](https://hl7.org/fhirpath/N1/#type-safety-and-strict-evaluation)).
 */
export type SemanticErrorCode =
  | 'semantic/unknown-function'
  | 'semantic/wrong-arity'
  | 'semantic/unknown-element'
  | 'semantic/unknown-type'
  | 'semantic/invalid-argument'
  | 'semantic/type-mismatch'
  | 'semantic/singleton-expected'
  | 'semantic/unordered-collection'
  | 'semantic/undefined-variable'
  | 'semantic/fraction-ignored';

/** Raised while an expression is evaluated. */
export type EvaluationErrorCode =
  | 'eval/singleton-expected'
  | 'eval/type-mismatch'
  | 'eval/undefined-variable'
  | 'eval/unknown-type'
  | 'eval/invalid-literal'
  | 'eval/invalid-argument'
  | 'eval/invalid-json'
  | 'eval/async-in-sync'
  | 'eval/aborted'
  | 'eval/limit-exceeded'
  | 'eval/datetime-out-of-range'
  | 'eval/invalid-calendar-unit';

/** Every stable error code. */
export type ErrorCode = SyntaxErrorCode | SemanticErrorCode | EvaluationErrorCode;
