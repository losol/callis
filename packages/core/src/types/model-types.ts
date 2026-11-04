import type { NamedType, SystemTypeName } from './system-types.ts';

/**
 * The part of a model that type resolution and type tests need.
 *
 * `ModelProvider` (in `model/model-provider.ts`) satisfies this interface structurally. It is
 * declared here because `types` must not depend on `model` (see the module dependency rules in
 * `docs/architecture.md`). The type parameter is the model's own type object, so functions such as
 * {@link resolveTypeSpecifier} give back the provider's `ModelTypeInfo`, not a bare
 * {@link NamedType}.
 *
 * @typeParam T - The model's type object, for example `ModelTypeInfo`.
 */
export interface ModelTypes<T extends NamedType> {
  /** The model namespace, such as `FHIR`. Searched before `System` for unqualified names. */
  readonly namespace: string;
  /** A type by its name in the model namespace, or undefined if the model has no such type. */
  getType(name: string): T | undefined;
  /** Whether `type` is `ancestor` or derives from it. */
  isSubtypeOf(type: T, ancestor: T): boolean;
  /** The System type that values of `type` convert to implicitly, if any. */
  getSystemType(type: T): SystemTypeName | undefined;
}
