import type { ModelTypes } from './model-types.ts';
import {
  findSystemType,
  type NamedType,
  SYSTEM_NAMESPACE,
  type SystemType,
} from './system-types.ts';

/**
 * A type name as written in an expression, before it is resolved: `Patient`, `FHIR.Patient` or
 * `System.String`. Used by `is`, `as` and `ofType()`.
 *
 * @see https://hl7.org/fhirpath/N1/#models
 */
export interface TypeSpecifier {
  /** The qualifier, such as `FHIR` in `FHIR.Patient`. Absent when the name is unqualified. */
  readonly namespace?: string;
  /** The type name, such as `Patient`. Delimited identifiers are already unquoted. */
  readonly name: string;
}

/**
 * Builds a {@link TypeSpecifier} from the identifiers of a qualified identifier, as the parser
 * reads them (`FHIR.Patient` is `['FHIR', 'Patient']`).
 *
 * One identifier is an unqualified name. With more, the first is the namespace and the rest,
 * joined with `.`, is the name, so `FHIR.Patient.contact` names the backbone type
 * `Patient.contact` in the `FHIR` namespace.
 */
export function typeSpecifierFromIdentifiers(
  identifiers: readonly [string, ...string[]],
): TypeSpecifier {
  const [first, ...rest] = identifiers;
  return rest.length === 0 ? { name: first } : { namespace: first, name: rest.join('.') };
}

/**
 * Resolves a type specifier to a System type or a model type.
 *
 * - An unqualified name is looked up in the model namespace first, then in `System`
 *   ([N1 §10.1](https://hl7.org/fhirpath/N1/#models)). With a FHIR model, `Quantity` is
 *   `FHIR.Quantity` and `Boolean` is `System.Boolean` (FHIR's type is `boolean`).
 * - A qualified name is looked up in its namespace only. There is no fallback, so
 *   `System.Patient` and `FHIR.Boolean` do not resolve.
 * - Names are case-sensitive.
 *
 * Returns undefined when the name does not resolve. The caller decides how to report that; the
 * spec makes it an error for `is`, `as` and `ofType()`.
 *
 * @param specifier - The type name as written.
 * @param model - The model, if there is one. Without a model only System types resolve.
 * @typeParam T - The model's type object, for example `ModelTypeInfo`.
 */
export function resolveTypeSpecifier<T extends NamedType>(
  specifier: TypeSpecifier,
  model?: ModelTypes<T>,
): SystemType | T | undefined {
  const { namespace, name } = specifier;
  if (namespace === undefined) {
    return model?.getType(name) ?? findSystemType(name);
  }
  if (namespace === SYSTEM_NAMESPACE) {
    return findSystemType(name);
  }
  if (model !== undefined && namespace === model.namespace) {
    return model.getType(name);
  }
  return undefined;
}
