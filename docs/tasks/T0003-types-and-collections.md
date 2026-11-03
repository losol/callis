# T0003 — Type system and collection foundations

Part of the [roadmap](../roadmap.md). Phase 1 · wave 1 · size M.

- **Depends on:** [T0000](T0000-scaffold.md)
- **Parallel with:** [T0001](T0001-lexer.md), [T0004](T0004-decimal.md), [T0005](T0005-date-time.md), [T0022](T0022-conformance-runner.md)
- **Background:** [ADR-0008](../adr/0008-model-provider.md)

## Goal

The shared, dependency-free building blocks used by the runtime, functions and model support ([architecture: values](../architecture.md#values-at-a-glance), [ModelProvider interface](#modelprovider-interface)).

## Scope

- `src/types/`:
  - System type names and `TypeSpecifier`
  - type-specifier resolution (model namespace first, then System)
  - the implicit-conversion table as data
  - `is`/`as` subtype checks against System types plus a `ModelProvider` hook
- `src/model/model-provider.ts`: the `ModelProvider`, `ModelTypeInfo` and `ElementInfo` interfaces. This is a contract used by T0018 and T0019, so review it carefully.
- `src/model/model-node.ts`: the `ModelNode` data class (structure only; navigation comes in T0008/T0018).
- `src/runtime/collection.ts`: the `Collection` type, the frozen `EMPTY`, and builder helpers.
- `src/runtime/logic.ts`: three-valued truth tables for `and`, `or`, `xor`, `implies` and `not`.
- `src/runtime/singleton.ts`: the four-step singleton evaluation from [N1 §4.5](https://hl7.org/fhirpath/N1/#singleton-evaluation-of-collections), with a conversion callback so it does not depend on value classes.
- `src/values/string.ts`: string equivalence normalization, plus equality, equivalence and comparison kernels for String, Integer and Boolean.

## Design notes

### Collections

- Every expression evaluates to a **collection**: a JavaScript array `readonly Item[]`. Empty is `[]`. Collections never contain `null` or `undefined`.
- Collections are **never mutated** after they are returned (enforced by `readonly` types). Builders use local mutable arrays. A shared frozen `EMPTY` constant avoids allocations.
- **Order** is preserved wherever the spec defines it (navigation, `combine`, indexers). Where the spec leaves order undefined (for example the `|` operator, [N1 §6.4.1](https://hl7.org/fhirpath/N1/#union-collections)), Callis still produces a deterministic order: left items first, then new items from the right.

### Type system

- A type is named by `{ namespace, name }`. The System types are `Any`, `Boolean`, `String`, `Integer`, `Long` (phase 2), `Decimal`, `Date`, `DateTime`, `Time` and `Quantity`, all derived from `System.Any`.
- **Resolving type specifiers** ([N1 §10.1](https://hl7.org/fhirpath/N1/#models)): an unqualified name is looked up in the model namespace first (for example `FHIR`), then in `System`. Qualified names (`FHIR.Patient`, `System.String`) are looked up directly.
- **`is`, `as` and `ofType`** accept the exact type or a subtype, using model inheritance. FHIR primitives follow the FHIR rules ([R5 §2.1.9.1.2](https://hl7.org/fhir/R5/fhirpath.html#types)): `Patient.birthDate is date` is true and `is System.Date` is false. `ofType()` accepts both.
- **Implicit conversions** ([N1 §5.5](https://hl7.org/fhirpath/N1/#conversion)): `Integer → Decimal`, `Integer → Quantity`, `Decimal → Quantity`, `Date → DateTime`. Phase 2 adds `Integer → Long` and `Long → Decimal`.
- **FHIR primitives map to System types** using the table on the FHIR page, with one deliberate difference: `FHIR.date` maps to `System.Date`, not `System.DateTime`. The test suite expects this (`birthDate` has output type `date`), and so do the other major implementations. `FHIR.Quantity` maps to `System.Quantity` only when it has a UCUM system and code ([R5 §2.1.9.1.3](https://hl7.org/fhir/R5/fhirpath.html#quantity)).
- **Explicit conversions** are the `toX()` and `convertsToX()` functions.
- **Model-less convenience:** a string that comes from untyped input data (not a string literal) is parsed on demand when it is compared with a date/time value. So `birthDate = @1974-12-25` works without a model. This rule is documented and tested, and it never applies when a model is present.

### Empty propagation and singleton evaluation

- **Operators:** an empty operand gives an empty result ([N1 §4.4.1](https://hl7.org/fhirpath/N1/#propagation-of-empty-results-in-expressions)). Exceptions follow the spec: Boolean operators use three-valued logic, `|`, `in` and `contains` have their own rules, `{} ~ {}` is `true`, and `&` treats empty as `''`.
- **Functions** define their own behaviour for empty input. Most return empty.
- **Singleton evaluation** ([N1 §4.5](https://hl7.org/fhirpath/N1/#singleton-evaluation-of-collections)) is one helper, `singleton(collection, expectedType)`, that implements the four-step rule:
  1. A single item that converts to the expected type is that value.
  2. A single item where a `Boolean` is expected is `true`.
  3. An empty collection stays empty.
  4. Anything else raises the error code `eval/singleton-expected`.
- **Boolean contexts** (`where` criteria, `iif` criteria, operands of `and`/`or`) use the same helper, producing `true`, `false` or empty.

### Three-valued logic

`and`, `or`, `xor`, `implies` and `not()` follow the truth tables in [N1 §6.5](https://hl7.org/fhirpath/N1/#boolean-logic), implemented over `true | false | undefined` (where `undefined` means empty). Both operands are always evaluated. The spec says short-circuiting must not change semantics, and an error in the right operand has to surface even when the left operand already decides the result. `iif()` is the lazy construct.

### Model principles

- The core does not know about any particular model. A model is supplied through `ModelProvider`.
- **Model-less mode** navigates plain JSON:
  - property names are JSON keys, and arrays are flattened
  - `resourceType` gives a resource its type name
  - JavaScript values map to System types: string → String, boolean → Boolean, integer number → Integer, other numbers → Decimal
  - there is no choice-type resolution, so `Observation.valueQuantity` works as an ordinary key
- **With a model**, navigation is type-directed: choice types, FHIR primitive types, inheritance, `_field` primitive extensions and semantic checks.

### ModelProvider interface

```ts
export interface ModelProvider {
  /** Namespace searched before System for unqualified type names, e.g. 'FHIR'. */
  readonly namespace: string;
  /** Model version, e.g. '4.0.1'. */
  readonly version: string;

  /** 'Patient', 'HumanName', 'string', 'Patient.contact' (backbone element types are named by path). */
  getType(name: string): ModelTypeInfo | undefined;
  /** Type of a root object, e.g. from `resourceType`. */
  getRootType(json: object): ModelTypeInfo | undefined;
  /** An element by its FHIRPath name (choice elements without [x]). */
  getElement(type: ModelTypeInfo, name: string): ElementInfo | undefined;
  /** All elements, in definition order; used by children(), descendants() and equality. */
  getElements(type: ModelTypeInfo): readonly ElementInfo[];
  isSubtypeOf(type: ModelTypeInfo, ancestor: ModelTypeInfo): boolean;
  /** System type for primitive model types, e.g. FHIR.code → System.String. */
  getSystemType(type: ModelTypeInfo): SystemTypeName | undefined;
}

export interface ModelTypeInfo {
  readonly namespace: string;     // 'FHIR'
  readonly name: string;          // 'Patient' | 'string' | 'Patient.contact'
  readonly kind: 'primitive' | 'complex' | 'resource' | 'backbone';
  readonly baseName?: string;     // 'DomainResource'
  readonly isAbstract: boolean;
}

export interface ElementInfo {
  readonly name: string;              // 'value' (no [x])
  readonly typeNames: readonly string[]; // more than one means a choice element
  readonly isArray: boolean;
  readonly isChoice: boolean;
}
```

The interface is **synchronous and pure**. Implementations precompute their indexes, and model data is immutable and shared across evaluations.

## Acceptance criteria

- [ ] The three-valued logic tables are tested exhaustively against [N1 §6.5](https://hl7.org/fhirpath/N1/#boolean-logic).
- [ ] All four branches of singleton evaluation are tested, including the `eval/singleton-expected` error.
- [ ] Type-specifier resolution is tested with a stub model: the model is searched before System, and qualified names resolve directly.
- [ ] String equivalence follows [N1 string equivalence](https://hl7.org/fhirpath/N1/#string-equivalence) (case, whitespace).
- [ ] The interfaces are documented with TSDoc.
