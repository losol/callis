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
  - `is`/`as` subtype checks against System types plus a `ModelProvider` hook. The hook is `ModelTypes<T>` in `src/types/model-types.ts`: the part of a model that the type system uses, which `ModelProvider` satisfies structurally, so `types` does not depend on `model`.
- `src/model/model-provider.ts`: the `ModelProvider`, `ModelTypeInfo` and `ElementInfo` interfaces. This is a contract used by T0018 and T0019, so review it carefully.
- `src/model/model-node.ts`: the `ModelNode` data class (structure only; navigation comes in T0008/T0018).
- `src/runtime/collection.ts`: the `Collection` type, the frozen `EMPTY`, and builder helpers.
- `src/runtime/logic.ts`: three-valued truth tables for `and`, `or`, `xor`, `implies` and `not`.
- `src/runtime/singleton.ts`: the four-step singleton evaluation from [N1 §4.5](https://hl7.org/fhirpath/N1/#singleton-evaluation-of-collections), with a conversion callback so it does not depend on value classes.
- `src/values/string.ts`: string equivalence normalization, plus equality and equivalence kernels for String, Integer and Boolean, and ordering kernels for String and Integer. Boolean has no ordering ([N1 §6.2](https://hl7.org/fhirpath/N1/#comparison)).
- `packages/core/test/support/stub-model.ts`: a small FHIR-like `ModelProvider` for tests, until the generated models exist (T0019).
- `packages/core/test/support/model-provider-contract.ts`: `describeModelProviderContract(provider, fixtures)`, a test suite for the rules below. The stub runs it here; [#56](https://github.com/losol/callis/issues/56) proposes that the generated models run it too.

## Design notes

### Collections

- Every expression evaluates to a **collection**: a JavaScript array `readonly Item[]`. Empty is `[]`. Collections never contain `null` or `undefined`, and never contain arrays: the `Item` type requires object items to be non-iterable, so a nested collection does not compile. T0008 may narrow `Item` to the closed union of value classes once they all exist.
- Collections are **never mutated** after they are returned (enforced by `readonly` types). Builders use local mutable arrays. A shared frozen `EMPTY` constant avoids allocations.
- **Order** is preserved wherever the spec defines it (navigation, `combine`, indexers). Where the spec leaves order undefined (for example the `|` operator, [N1 §6.4.1](https://hl7.org/fhirpath/N1/#union-collections)), Callis still produces a deterministic order: left items first, then new items from the right.

### Type system

- A type is named by `{ namespace, name }`. The System types are `Any`, `Boolean`, `String`, `Integer`, `Long` (phase 2), `Decimal`, `Date`, `DateTime`, `Time` and `Quantity`, all derived from `System.Any`.
- **Resolving type specifiers** ([N1 §10.1](https://hl7.org/fhirpath/N1/#models)): an unqualified name is looked up in the model namespace first (for example `FHIR`), then in `System`. Qualified names (`FHIR.Patient`, `System.String`) are looked up directly. The pure resolver still returns `undefined` for an unknown name; T0008 owns [execution errors](T0008-compiler-evaluator.md#type-names-that-do-not-resolve) and the separate [model-less resource-name matcher](T0008-compiler-evaluator.md#resource-type-names-without-a-model) ([#58](https://github.com/losol/callis/issues/58), [#59](https://github.com/losol/callis/issues/59)).
- **`is`, `as` and `ofType`** accept the exact type or a subtype, using model inheritance. FHIR primitives follow the FHIR rules ([R5 §2.1.9.1.2](https://hl7.org/fhir/R5/fhirpath.html#types)): `Patient.birthDate is date` is true and `is System.Date` is false. `ofType()` accepts both.
- **Implicit conversions** ([N1 §5.5](https://hl7.org/fhirpath/N1/#conversion)): `Integer → Decimal`, `Integer → Quantity`, `Decimal → Quantity`, `Date → DateTime`. Phase 2 adds `Integer → Long`, `Long → Decimal` and `Long → Quantity` (the [3.0.0 table](https://hl7.org/fhirpath/STU3/#conversion); T0028's task file lists only the first two, see [#62](https://github.com/losol/callis/issues/62)). `System.Long` is already a System type name, so a model can map R5's `integer64` to it.
- **FHIR primitives map to System types** using the table on the FHIR page, with one deliberate difference: `FHIR.date` maps to `System.Date`, not `System.DateTime`. The test suite expects this (`birthDate` has output type `date`), and so do the other major implementations. `FHIR.Quantity` maps to `System.Quantity` only when it has a UCUM system and code ([R5 §2.1.9.1.3](https://hl7.org/fhir/R5/fhirpath.html#quantity)).
- **Explicit conversions** are the `toX()` and `convertsToX()` functions.
- **Model-less convenience:** a string that comes from untyped input data (not a string literal) is parsed on demand when it is compared with a date/time value. So `birthDate = @1974-12-25` works without a model. The rule never applies when a model is present. It needs the date/time values (T0005) and the equality and comparison dispatch, so T0003 does not implement it; [#55](https://github.com/losol/callis/issues/55) proposes T0009 as its home.

### Empty propagation and singleton evaluation

- **Operators:** an empty operand gives an empty result ([N1 §4.4.1](https://hl7.org/fhirpath/N1/#propagation-of-empty-results-in-expressions)). Exceptions follow the spec: Boolean operators use three-valued logic, `|`, `in` and `contains` have their own rules, `{} ~ {}` is `true`, and `&` treats empty as `''`.
- **Functions** define their own behaviour for empty input. Most return empty.
- **Singleton evaluation** ([N1 §4.5](https://hl7.org/fhirpath/N1/#singleton-evaluation-of-collections)) is one helper, `singleton(collection, expectedType, convert)`, that implements the four-step rule. `convert` turns the item into the expected type, or returns undefined when it cannot, so the helper does not depend on the value classes:
  1. A single item that converts implicitly to the expected type is that value (3.0.0 says "implicitly converted").
  2. A single item where a `Boolean` is expected is `true`.
  3. An empty collection stays empty.
  4. Anything else is an error: more than one item raises `eval/singleton-expected`, and a single item that does not convert to an expected type other than Boolean raises `eval/type-mismatch` (owner decision, 2026-11-05).
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

The TSDoc in `src/model/model-provider.ts` is the full contract. The points that implementers (T0019) and users (T0018, T0024) rely on:

- `ModelTypeInfo.kind` has its own type, `ModelTypeKind`.
- `namespace` is never `System`. Type names are case-sensitive.
- Lookups are prototype-safe: `getType('constructor')` and `getElement(type, '__proto__')` are undefined unless the model defines them, and `getRootType()` reads `resourceType` as an own property.
- `getType()` should return the same object for the same type, so the common case compares by identity. Methods that take a `ModelTypeInfo` identify it by name, so a copy gives the same answers; the engine also treats equal namespace and name as the same type.
- `getElement()` and `getElements()` include inherited elements and return the same `ElementInfo` objects every time, so callers can cache derived data keyed on them. `getElements()` lists them in snapshot order, base types first. A primitive type's implicit `value` is not an element.
- Every name in `ElementInfo.typeNames` resolves with `getType()`: backbone types by path, `contentReference` resolved, and System-typed elements such as FHIR's `Element.id` given as the matching model type (`string`).
- A choice element appears in JSON as its name plus the type name with the first letter in upper case (`valueQuantity`), even when only one type is allowed. `choiceJsonName(name, typeName)` in `model-provider.ts` is the one implementation of this rule, for T0018, T0019 and T0024.
- `isSubtypeOf()` is reflexive.
- `getSystemType()` never returns `Any` (its type excludes it). It covers every type whose values convert implicitly, including derived primitives (`code` → `String`) and `Quantity` with its specializations (`Age`). For `Quantity` this is the type-level answer; whether a value has the UCUM code it needs is checked when the value is converted.

## Acceptance criteria

- [ ] The three-valued logic tables are tested exhaustively against [N1 §6.5](https://hl7.org/fhirpath/N1/#boolean-logic).
- [ ] All four branches of singleton evaluation are tested, including the `eval/singleton-expected` and `eval/type-mismatch` errors.
- [ ] Type-specifier resolution is tested with a stub model: the model is searched before System, and qualified names resolve directly.
- [ ] String equivalence follows [N1 string equivalence](https://hl7.org/fhirpath/N1/#string-equivalence) (case, whitespace).
- [ ] The interfaces are documented with TSDoc.
