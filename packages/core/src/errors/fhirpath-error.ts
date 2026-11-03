import type { Diagnostic } from './diagnostic.ts';
import type {
  ErrorCode,
  EvaluationErrorCode,
  SemanticErrorCode,
  SyntaxErrorCode,
} from './error-codes.ts';
import type { SourceSpan } from './source-span.ts';

/** Optional context for a {@link FhirPathError}. */
export interface FhirPathErrorOptions {
  /** Where in the expression the problem is. */
  readonly span?: SourceSpan;
  /** The full expression text. {@link FhirPathError.format} uses it to show the failing line. */
  readonly expression?: string;
  /** The underlying error, when this error wraps another one. */
  readonly cause?: unknown;
}

/**
 * Base class for every error Callis throws, so callers can catch them all with one check.
 *
 * `code` is stable and meant for programs; `message` is meant for people and may change.
 */
export abstract class FhirPathError extends Error {
  readonly code: ErrorCode;
  readonly span: SourceSpan | undefined;
  readonly expression: string | undefined;

  protected constructor(code: ErrorCode, message: string, options: FhirPathErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.span = options.span;
    this.expression = options.expression;
  }

  /**
   * Formats the error for people: name, code and message, then the failing line of the expression
   * with a caret under the span when both the span and the expression are known.
   *
   * @example
   * ```text
   * FhirPathSyntaxError [syntax/unexpected-token]: Expected ')' but found end of input
   *   Patient.name.where(use = 'official'
   *                                      ^
   * ```
   */
  format(): string {
    const header = `${this.name} [${this.code}]: ${this.message}`;
    if (this.span === undefined || this.expression === undefined) {
      return header;
    }
    const excerpt = formatExcerpt(this.expression, this.span);
    return excerpt === undefined ? header : `${header}\n${excerpt}`;
  }
}

/** The expression is not valid FHIRPath syntax. */
export class FhirPathSyntaxError extends FhirPathError {
  override readonly name: string = 'FhirPathSyntaxError';
  declare readonly code: SyntaxErrorCode;

  constructor(code: SyntaxErrorCode, message: string, options?: FhirPathErrorOptions) {
    super(code, message, options);
  }
}

/** Options for a {@link FhirPathSemanticError}. */
export interface FhirPathSemanticErrorOptions extends FhirPathErrorOptions {
  /** Every problem found. Defaults to a single error built from the code, message and span. */
  readonly diagnostics?: readonly Diagnostic[];
}

/**
 * The expression is valid syntax but cannot be compiled, for example because it calls an unknown
 * function. The error's own code, message and span describe the first problem; `diagnostics`
 * lists all of them.
 */
export class FhirPathSemanticError extends FhirPathError {
  override readonly name: string = 'FhirPathSemanticError';
  declare readonly code: SemanticErrorCode;
  readonly diagnostics: readonly Diagnostic[];

  constructor(
    code: SemanticErrorCode,
    message: string,
    options: FhirPathSemanticErrorOptions = {},
  ) {
    super(code, message, options);
    this.diagnostics = options.diagnostics ?? [
      {
        severity: 'error',
        code,
        message,
        ...(options.span === undefined ? {} : { span: options.span }),
      },
    ];
  }
}

/** Evaluation stopped because the spec requires an error, for example a singleton violation. */
export class FhirPathEvaluationError extends FhirPathError {
  override readonly name: string = 'FhirPathEvaluationError';
  declare readonly code: EvaluationErrorCode;

  constructor(code: EvaluationErrorCode, message: string, options?: FhirPathErrorOptions) {
    super(code, message, options);
  }
}

const LINE_BREAK = /\r\n|\r|\n/;

/** The span's line, indented, with carets under the span. Undefined if the line does not exist. */
function formatExcerpt(expression: string, span: SourceSpan): string | undefined {
  const text = expression.split(LINE_BREAK)[span.line - 1];
  if (text === undefined) {
    return undefined;
  }
  const column = Math.min(Math.max(span.column, 1), text.length + 1);
  const width = Math.max(1, Math.min(span.end - span.start, text.length - column + 1));
  // Keep tabs so the caret lines up with the text above it.
  const indent = text.slice(0, column - 1).replace(/[^\t]/g, ' ');
  return `  ${text}\n  ${indent}${'^'.repeat(width)}`;
}
