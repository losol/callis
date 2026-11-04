import type { SystemTypeName } from './system-types.ts';

function targets(...names: SystemTypeName[]): readonly SystemTypeName[] {
  return Object.freeze(names);
}

/**
 * The implicit conversions between System types, as data: for each type, the types its values
 * convert to automatically when an operator or function needs them
 * ([N1 §5.5](https://hl7.org/fhirpath/N1/#conversion)).
 *
 * | From | To |
 * | --- | --- |
 * | Integer | Decimal, Quantity |
 * | Decimal | Quantity |
 * | Date | DateTime |
 *
 * Explicit conversions (`toInteger()`, `convertsToDecimal()`, …) are functions, not entries in
 * this table.
 */
export const IMPLICIT_CONVERSIONS: Readonly<Record<SystemTypeName, readonly SystemTypeName[]>> =
  Object.freeze({
    Any: targets(),
    Boolean: targets(),
    String: targets(),
    Integer: targets('Decimal', 'Quantity'),
    // TODO(T0028): add Integer → Long, Long → Decimal and Long → Quantity (FHIRPath 3.0.0 table).
    Long: targets(),
    Decimal: targets('Quantity'),
    Date: targets('DateTime'),
    DateTime: targets(),
    Time: targets(),
    Quantity: targets(),
  });

/**
 * Whether values of type `from` can be used where `to` is expected without an explicit
 * conversion: the types are the same, or {@link IMPLICIT_CONVERSIONS} lists the conversion.
 *
 * Subtyping is a different relation: every type is a `System.Any`, but nothing converts to `Any`.
 * Use `isOfType()` for that.
 */
export function canConvertImplicitly(from: SystemTypeName, to: SystemTypeName): boolean {
  return from === to || IMPLICIT_CONVERSIONS[from].includes(to);
}
