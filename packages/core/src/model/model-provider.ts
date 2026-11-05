/**
 * The contract between the engine and a data model such as FHIR R4 or R5.
 *
 * The core knows no particular model. Without a provider it navigates plain JSON; with one,
 * navigation is type-directed (choice types, FHIR primitives, inheritance) and `is`, `as` and
 * `ofType()` understand model types. `@callis/fhir-r4` and `@callis/fhir-r5` implement this
 * interface from generated data (T0019); evaluation uses it from T0018 on.
 *
 * @see https://hl7.org/fhirpath/N1/#models
 * @see https://hl7.org/fhir/R5/fhirpath.html#types
 */
import type { SystemTypeName } from '../types/system-types.ts';

/**
 * What kind of type a model type is.
 *
 * - `primitive`: a type with a primitive value, such as FHIR `string` or `date`.
 * - `complex`: a reusable structure, such as `HumanName` or `Quantity`, and abstract bases such
 *   as `Element`.
 * - `resource`: a resource, such as `Patient`, and abstract bases such as `DomainResource`.
 * - `backbone`: a structure defined inline in another type, named by its path
 *   (`Patient.contact`).
 */
export type ModelTypeKind = 'primitive' | 'complex' | 'resource' | 'backbone';

/**
 * A type defined by a model.
 *
 * Model data is immutable and shared across evaluations. A provider should return the same object
 * for the same type every time, so the common case compares by identity. A type is identified by
 * its namespace and name, though: provider methods accept a copy as the same type (see
 * {@link ModelProvider}), and so does the engine.
 */
export interface ModelTypeInfo {
  /** The model namespace, such as `FHIR`. Always the provider's {@link ModelProvider.namespace}. */
  readonly namespace: string;
  /**
   * The type name within the namespace: `Patient`, `string`, or a path such as `Patient.contact`
   * for a backbone type.
   */
  readonly name: string;
  /** Whether the type is a primitive, a complex type, a resource or a backbone type. */
  readonly kind: ModelTypeKind;
  /**
   * The name of the base type in the same namespace, such as `DomainResource` for `Patient` or
   * `string` for FHIR `code`. Absent for a root type.
   */
  readonly baseName?: string;
  /** Whether the type is abstract, such as `Resource` or `DomainResource`. */
  readonly isAbstract: boolean;
}

/**
 * An element of a model type, as FHIRPath navigates it.
 *
 * @example
 * ```ts
 * // Observation.value[x]
 * { name: 'value', typeNames: ['Quantity', 'CodeableConcept', 'string', …], isArray: false, isChoice: true }
 * ```
 */
export interface ElementInfo {
  /**
   * The name used in FHIRPath expressions. For a choice element this is the name without `[x]`
   * (`value`, not `value[x]`).
   */
  readonly name: string;
  /**
   * The names of the element's types in the model namespace. Each one resolves with
   * {@link ModelProvider.getType}:
   *
   * - an inline structure has its backbone type name (`Patient.contact`)
   * - a `contentReference` is resolved to the type it refers to (`Questionnaire.item.item` has
   *   type `Questionnaire.item`)
   * - where the source definitions give an element a System type (FHIR's `Element.id`,
   *   `Extension.url`), the provider lists the matching model type (`string`, `uri`)
   *
   * More than one name only occurs for a choice element.
   */
  readonly typeNames: readonly string[];
  /** Whether the element repeats (maximum cardinality above 1), so its JSON value is an array. */
  readonly isArray: boolean;
  /**
   * Whether the element is a choice (`[x]`). In JSON a choice element appears under its name
   * followed by the type name with its first letter in upper case ({@link choiceJsonName}):
   * `valueQuantity`, `valueDateTime`. This holds even when only one type is allowed.
   */
  readonly isChoice: boolean;
}

/**
 * The JSON property name of a choice element for one of its types: the element name followed by
 * the type name with its first letter in upper case
 * ([FHIR choice of data types](https://hl7.org/fhir/R4/formats.html#choice)).
 *
 * @example
 * ```ts
 * choiceJsonName('value', 'Quantity'); // 'valueQuantity'
 * choiceJsonName('value', 'dateTime'); // 'valueDateTime'
 * ```
 */
export function choiceJsonName(name: string, typeName: string): string {
  return name + typeName.charAt(0).toUpperCase() + typeName.slice(1);
}

/**
 * A data model that the engine can use for type-directed navigation and type tests.
 *
 * Implementations must be:
 *
 * - **synchronous and pure**: every method returns the same answer for the same arguments and
 *   has no side effects;
 * - **precomputed**: lookups are cheap, because they run on the evaluation hot path;
 * - **immutable and shareable**: one provider is used by many concurrent evaluations;
 * - **prototype-safe**: names come from expressions and input data, so a lookup of
 *   `constructor`, `__proto__` or `toString` returns undefined unless the model really defines
 *   it. Use `Map`, objects created with `Object.create(null)`, or `Object.hasOwn`;
 * - **keyed by name**: methods that take a {@link ModelTypeInfo} identify it by its `name`, so a
 *   copy (`{ ...type }`) gives the same answers as the object the provider returned.
 *
 * `namespace`, `getType`, `isSubtypeOf` and `getSystemType` are also what the type system uses
 * to resolve type specifiers and to run `is`, `as` and `ofType()`.
 *
 * Until 1.0 this interface may change, including breaking changes; each one is called out in the
 * changelog.
 */
export interface ModelProvider {
  /**
   * The model namespace, such as `FHIR`. Unqualified type names are looked up here before
   * `System`. It must not be `System`.
   */
  readonly namespace: string;
  /** The model version, such as `4.0.1`. */
  readonly version: string;

  /**
   * A type by its name in the model namespace, without the namespace: `Patient`, `HumanName`,
   * `string`, or a backbone path such as `Patient.contact`. Names are case-sensitive. Returns
   * undefined if the model has no such type.
   */
  getType(name: string): ModelTypeInfo | undefined;

  /**
   * The type of a root object, such as an input resource, a contained resource or
   * `Bundle.entry.resource`. For FHIR this is the resource type named by the object's own
   * `resourceType` property.
   *
   * Returns undefined when the object does not identify a type of this model. Read the input
   * through own-property checks only; it is untrusted data.
   */
  getRootType(json: object): ModelTypeInfo | undefined;

  /**
   * An element of a type by its FHIRPath name, including elements inherited from base types.
   * A choice element is found by its name without `[x]` (`value`), not by a JSON key with a
   * type suffix (`valueQuantity`). Returns undefined if the type has no such element.
   *
   * The same `ElementInfo` object is returned for the same element every time, here and in
   * {@link ModelProvider.getElements}, so callers can cache derived data keyed on it (for
   * example in a `WeakMap`).
   */
  getElement(type: ModelTypeInfo, name: string): ElementInfo | undefined;

  /**
   * All elements of a type, including inherited ones, in definition order: elements of base
   * types first, as in a FHIR snapshot. `children()`, `descendants()` and equality of complex
   * values use this order.
   *
   * The implicit `value` of a primitive type is not an element: a FHIR `string` lists `id` and
   * `extension` only. The `ElementInfo` objects are the ones {@link ModelProvider.getElement}
   * returns.
   */
  getElements(type: ModelTypeInfo): readonly ElementInfo[];

  /**
   * Whether `type` is `ancestor` or derives from it, directly or through other base types.
   * The relation is reflexive: every type is a subtype of itself.
   */
  isSubtypeOf(type: ModelTypeInfo, ancestor: ModelTypeInfo): boolean;

  /**
   * The System type that values of a model type convert to implicitly, or undefined if they do
   * not convert. Never `Any`, which is only a supertype. For FHIR this covers the primitives, including derived ones (`code` →
   * `String`), and `Quantity` with its specializations such as `Age`
   * ([R5 §2.1.9.1.2](https://hl7.org/fhir/R5/fhirpath.html#types)).
   *
   * Callis maps `FHIR.date` to `Date`, not `DateTime` as the FHIR table says; the test suite
   * and the other major implementations do the same (`docs/spec-notes.md`). For `Quantity` the
   * answer is the type-level mapping: a value only converts when it has a UCUM code
   * ([R5 §2.1.9.1.3](https://hl7.org/fhir/R5/fhirpath.html#quantity)), which is checked when
   * the value is converted.
   */
  getSystemType(type: ModelTypeInfo): Exclude<SystemTypeName, 'Any'> | undefined;
}
