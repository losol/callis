/**
 * The System types that FHIRPath defines itself, independent of any model.
 *
 * @see https://hl7.org/fhirpath/N1/#literals
 * @see https://hl7.org/fhirpath/N1/#models
 */

/** The namespace of the built-in types, as in `System.Integer`. */
export const SYSTEM_NAMESPACE = 'System';

/**
 * The name of a System type.
 *
 * `Any` is the root of every type ([N1 §4.1](https://hl7.org/fhirpath/N1/#literals)). `Long`
 * belongs to phase 2 (T0028); it is listed now so that a model can map a type such as R5's
 * `FHIR.integer64` to it.
 */
export type SystemTypeName =
  | 'Any'
  | 'Boolean'
  | 'String'
  | 'Integer'
  | 'Long'
  | 'Decimal'
  | 'Date'
  | 'DateTime'
  | 'Time'
  | 'Quantity';

/**
 * A type named by its namespace and name, such as `System.String` or `FHIR.Patient`.
 *
 * Both {@link SystemType} and model types (`ModelTypeInfo`) have this shape, so code that only needs
 * the name works with either.
 */
export interface NamedType {
  readonly namespace: string;
  readonly name: string;
}

/** A System type. Use the shared objects in {@link SYSTEM_TYPES}; never build one by hand. */
export interface SystemType extends NamedType {
  readonly namespace: typeof SYSTEM_NAMESPACE;
  readonly name: SystemTypeName;
}

function systemType(name: SystemTypeName): SystemType {
  return Object.freeze({ namespace: SYSTEM_NAMESPACE, name });
}

/**
 * One shared, frozen object per System type, so a resolved type can be stored once at compile time
 * and compared cheaply at runtime.
 */
export const SYSTEM_TYPES: Readonly<Record<SystemTypeName, SystemType>> = Object.freeze({
  Any: systemType('Any'),
  Boolean: systemType('Boolean'),
  String: systemType('String'),
  Integer: systemType('Integer'),
  Long: systemType('Long'),
  Decimal: systemType('Decimal'),
  Date: systemType('Date'),
  DateTime: systemType('DateTime'),
  Time: systemType('Time'),
  Quantity: systemType('Quantity'),
});

/**
 * Whether a string is the name of a System type. Names are case-sensitive: `Boolean` is a System
 * type name, `boolean` is not. `Object.prototype` members such as `constructor` are not.
 */
export function isSystemTypeName(name: string): name is SystemTypeName {
  return Object.hasOwn(SYSTEM_TYPES, name);
}

/**
 * Looks up a System type by its unqualified name, or returns undefined if there is none. Follows
 * the rules of {@link isSystemTypeName}.
 */
export function findSystemType(name: string): SystemType | undefined {
  return isSystemTypeName(name) ? SYSTEM_TYPES[name] : undefined;
}

/**
 * Whether a type is a System type. A model never uses the `System` namespace, so the namespace
 * decides.
 */
export function isSystemType(type: NamedType): type is SystemType {
  return type.namespace === SYSTEM_NAMESPACE;
}
