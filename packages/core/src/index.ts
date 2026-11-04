/**
 * Public API of `@callis/core`.
 *
 * Everything exported from this file is public API; internal modules are imported directly, never
 * through this file. The evaluation API comes in later tasks; for now the package exports the
 * types a data model implements, so model packages such as `@callis/fhir-r4` can build on them.
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
