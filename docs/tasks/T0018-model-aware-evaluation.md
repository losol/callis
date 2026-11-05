# T0018 — Model-aware evaluation

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size L.

- **Depends on:** [T0008](T0008-compiler-evaluator.md)
- **Parallel with:** [T0010](T0010-operators.md)–[T0017](T0017-fn-tree-utility.md)
- **Background:** [ADR-0008](../adr/0008-model-provider.md), [ADR-0012](../adr/0012-evaluation-defaults.md) (strict choice types by default)

## Goal

Use a `ModelProvider` during evaluation ([design notes](#design-notes)).

## Scope

- Typed navigation:
  - `ModelNode.type` set from the model
  - choice elements (`value` → `valueQuantity`, etc.)
  - `lenient.choiceSuffix`
  - primitive extensions (`_field`, index-aligned arrays)
  - extension-only primitives
- Converting FHIR primitives to System values (memoized), with `FHIR.date` → `System.Date`.
- The root identifier as a type, with inheritance (`DomainResource.contained…`).
- `is`, `as` and `ofType` with model types, following the FHIR rules for primitives.
- Model-ordered `children()` and `descendants()`.
- `parseJson()`: a lossless JSON parser (`JsonNumber`), which navigation understands.
- A hand-written mini FHIR model fixture (Patient, Observation, HumanName, Quantity, Extension and the primitives) so that this task does not wait for T0019.

## Design notes

The `ModelProvider` interface and the type rules this task relies on (type-specifier resolution, FHIR primitive → System mapping, the model-less date convenience) are in [T0003](T0003-types-and-collections.md#design-notes).

### ModelNode

Data from the input is wrapped in a small `ModelNode`. It is a class, so V8 sees a single object shape:

```ts
class ModelNode {
  readonly value: unknown;            // JSON value; undefined for a primitive with only extensions
  readonly primitiveElement?: object; // the matching `_name` object (id/extension) for FHIR primitives
  readonly type?: ModelTypeInfo;      // undefined in model-less mode
  readonly name: string;              // element name (for trace, pathname, children)
  readonly parent?: ModelNode;        // used for %resource, %rootResource and contained-reference resolution
  readonly index?: number;            // position in a repeating element
}
```

Nodes are created lazily during navigation. Conversion to a System value (for example `FHIR.date` → `DateValue`) is memoized on the node.

### Choice types and primitive extensions

- **Choice elements** ([R5 §2.1.9.1.1](https://hl7.org/fhir/R5/fhirpath.html#polymorphism)): `Observation.value` looks up the JSON keys `value` + type suffix (`valueQuantity`, `valueString`, …) for each allowed type, and the node gets the type it matched. Writing `Observation.valueQuantity` is not valid FHIRPath: it is a semantic error with a model (test `testPolymorphismB`). A `lenient: { choiceSuffix: true }` option accepts it for compatibility (test mode `lenient/polymorphics`).
- **Primitive extensions** ([FHIR JSON](https://hl7.org/fhir/R4/json.html#primitive)): `birthDate` and `_birthDate` are merged into one node. Arrays are aligned by index, with `null` placeholders. A node exists when either part exists. `hasValue()` is false when only the extension exists, and such a node behaves as empty in System-typed operations.

### Navigation rules

1. With a model, `getElement(type, name)` decides what a name means. An unknown element is a semantic error when the analyzer knows the type. At runtime it is empty in normal mode and an error in strict mode.
2. `contained` resources and `Bundle.entry.resource` take their type from `resourceType`.
3. **Root identifier as a type** ([N1 §10.1](https://hl7.org/fhirpath/N1/#models), [R5 §2.1.9.1](https://hl7.org/fhir/R5/fhirpath.html#rules)):
   - If the first identifier names a type and the input is of that type (or a subtype, as with `DomainResource`), it evaluates to the input.
   - If it names a different type, the result is empty in normal mode and a semantic error in strict mode.
   - Otherwise it is an ordinary path.
   - Without a model, an identifier that matches the input's `resourceType` is treated as the type name.
4. `children()` and `descendants()` use `getElements()` with a model and the JSON keys without one. Keys starting with `_` are folded into their primitives and never appear as children.

### Lossless decimals in JSON input

`JSON.parse` turns `1.50` into `1.5`, which loses precision that FHIRPath can observe (`toString()`, `~`, `precision()`). Callis accepts ordinary parsed JSON, which is convenient but lossy. It also exports `parseJson(text)`, a small parser with no dependencies that keeps each numeric literal as a `JsonNumber` holding the source text. Navigation understands both forms. The conformance runner uses the lossless path through the adapter's optional `parseInput(text)` hook in `tools/conformance/src/engine-adapter.ts`: set it to `parseJson`. Without that hook the runner defaults to `JSON.parse` ([T0022: adapter interface](T0022-conformance-runner.md#adapter-interface), [#48](https://github.com/losol/callis/issues/48)).

## Acceptance criteria

- [ ] `Observation.value.ofType(Quantity).unit` works. `Observation.valueQuantity` is empty or a semantic error by default, and works with `lenient.choiceSuffix`.
- [ ] `Patient.name.given` on `["a", null]` with `_given: [null, {extension}]` gives two nodes, and the second has `hasValue()` false (checked once T0020 is merged).
- [ ] With `parseJson`, `1.50` keeps its precision end to end (`toString()` returns `'1.50'`).
- [ ] With the real R4 model (once T0019 is merged), conformance groups `testBasics`, `testObservations`, `polymorphics`, `testInheritance`, `testMiscellaneousAccessorTests` and the model parts of `testTypes` pass.
