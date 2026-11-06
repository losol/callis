/**
 * Public API of `@callis/core`.
 *
 * Everything exported from this file is public API; internal modules are imported directly, never
 * through this file. The evaluation API comes in later tasks; for now the package exports the
 * types a data model implements, so model packages such as `@callis/fhir-r4` can build on them,
 * and the `UnitSystem` contract with `Decimal` and the minimal unit system, so unit packages such
 * as `@callis/ucum` can implement and extend it.
 *
 * @packageDocumentation
 */
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
