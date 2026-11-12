/**
 * Public API of `@callis/core`.
 *
 * Synchronous model-less evaluation and analysis, plain result values, errors, lossless JSON
 * input, and the contracts used by model and unit-provider packages. Internal modules are
 * imported directly, never through here.
 *
 * @packageDocumentation
 */

export type { PlainQuantity } from './api/output.ts';
export type {
  AnalysisResult,
  CompiledExpression,
  CompileOptions,
  EvaluateOptions,
} from './api/public-api.ts';
export { analyze, compile, evaluate } from './api/public-api.ts';
export type { Diagnostic } from './errors/diagnostic.ts';
export type {
  ErrorCode,
  EvaluationErrorCode,
  SemanticErrorCode,
  SyntaxErrorCode,
} from './errors/error-codes.ts';
export type {
  FhirPathErrorOptions,
  FhirPathSemanticErrorOptions,
} from './errors/fhirpath-error.ts';
export {
  FhirPathError,
  FhirPathEvaluationError,
  FhirPathSemanticError,
  FhirPathSyntaxError,
} from './errors/fhirpath-error.ts';
export type { SourceSpan } from './errors/source-span.ts';
export type { JsonValue } from './model/lossless-json.ts';
export { JsonNumber, parseJson } from './model/lossless-json.ts';
export type {
  ElementInfo,
  ModelProvider,
  ModelTypeInfo,
  ModelTypeKind,
} from './model/model-provider.ts';
export type { SystemTypeName } from './types/system-types.ts';
export { Decimal, MAX_DECIMAL_DIGITS } from './values/decimal/decimal.ts';
export type {
  ParsedUnit,
  UnitConversionOptions,
  UnitProduct,
  UnitSystem,
} from './values/quantity/unit-system.ts';
export { minimalUnitSystem } from './values/quantity/unit-system.ts';
