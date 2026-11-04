/**
 * Type tests behind `is`, `as` and `ofType()`. They compare types, not values: finding the type of
 * an item is the runtime's job.
 *
 * @see https://hl7.org/fhirpath/N1/#types-and-reflection
 * @see https://hl7.org/fhir/R5/fhirpath.html#types
 */
import type { ModelTypes } from './model-types.ts';
import { isSystemType, type NamedType, SYSTEM_TYPES, type SystemType } from './system-types.ts';

/** Whether two types have the same namespace and name. */
export function isSameType(a: NamedType, b: NamedType): boolean {
  return a === b || (a.namespace === b.namespace && a.name === b.name);
}

/**
 * Whether a value of type `type` passes `is target`; `as` uses the same test.
 *
 * True when `type` is `target` or a subtype of it ([N1 §6.3.1](https://hl7.org/fhirpath/N1/#is-type-specifier)):
 *
 * - Every type is a `System.Any`, the root of all types
 *   ([N1 §4.1](https://hl7.org/fhirpath/N1/#literals)).
 * - Other System types have no subtypes. `Integer` is not a `Decimal`; it only converts to one.
 * - Model types follow the model's inheritance, through `isSubtypeOf()`.
 * - A model type is never a System type other than `Any`, even when its values convert to one.
 *   This is the FHIR rule for primitives ([R5 §2.1.9.1.2](https://hl7.org/fhir/R5/fhirpath.html#types)):
 *   `Patient.birthDate is date` is true and `Patient.birthDate is System.Date` is false.
 *
 * @param type - The type of the value being tested.
 * @param target - The resolved type specifier.
 * @param model - The model both types come from, if any. Without one, model types only match
 *   themselves.
 */
export function isOfType<T extends NamedType>(
  type: SystemType | T,
  target: SystemType | T,
  model?: ModelTypes<T>,
): boolean {
  if (isSameType(type, target)) {
    return true;
  }
  if (isSystemType(target)) {
    return target.name === 'Any';
  }
  if (isSystemType(type)) {
    return false;
  }
  return model?.isSubtypeOf(type, target) === true;
}

/**
 * Whether a value of type `type` passes `ofType(target)`.
 *
 * Like {@link isOfType}, but a model type also matches the System type its values convert to.
 * `ofType()` does not have the restriction of `is`, so `Patient.name.given.ofType(FHIR.string)`
 * and `Patient.name.given.ofType(System.String)` both keep the given names
 * ([R5 §2.1.9.1.2](https://hl7.org/fhir/R5/fhirpath.html#types)).
 *
 * This is a type-level check. Whether a particular value converts (a FHIR `Quantity` only maps
 * to `System.Quantity` when it has a UCUM code) is checked when the value is converted.
 */
export function matchesOfType<T extends NamedType>(
  type: SystemType | T,
  target: SystemType | T,
  model?: ModelTypes<T>,
): boolean {
  if (isOfType(type, target, model)) {
    return true;
  }
  if (model === undefined || !isSystemType(target) || isSystemType(type)) {
    return false;
  }
  const systemName = model.getSystemType(type);
  return systemName !== undefined && isOfType(SYSTEM_TYPES[systemName], target);
}
