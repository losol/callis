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
  - `lenient.choiceSuffix` (the internal `CompileOptions.lenient`; the public option is [T0038](T0038-public-api-completion.md))
  - primitive extensions (`_field`, index-aligned arrays)
  - extension-only primitives
- Converting FHIR primitives to System values (memoized), with `FHIR.date` → `System.Date`.
- The root identifier as a type, with inheritance (`DomainResource.contained…`).
- `is`, `as` and `ofType` with model types, following the FHIR rules for primitives and [T0008 target resolution](T0008-compiler-evaluator.md#type-names-that-do-not-resolve). A supplied model disables the model-less resource-name fallback, including for nodes whose model type is unknown. The `ofType()` matching rule is in the type-target runtime; the function itself is [T0042](T0042-fn-projection-completion.md).
- Model-ordered children: the `navigateChildren()` helper in `runtime/navigation.ts`, on which [T0017](T0017-fn-tree-utility.md) registers `children()` and `descendants()`.
- Typed complex values in `=` and `~`: elements instead of JSON keys, and the [rule for FHIR Quantities without a UCUM code](../spec-notes.md#fhir-quantities-without-a-ucum-code).
- `parseJson()`: a lossless JSON parser (`JsonNumber`), which navigation understands; both are public exports.
- The conformance runner evaluates with the generated R4 and R5 models ([T0019](T0019-fhir-model-generator.md)) and parses its inputs with `parseJson()`, and registers the suite exceptions `testType22` and `testFHIRPathAsFunction11`/`16` ([#111](https://github.com/losol/callis/issues/111)).
- The mini FHIR model fixture (`packages/core/test/support/stub-model.ts`, from T0003) is extended with the types these tests need, so the core's unit tests do not depend on the generated packages.
- R6 support through the same code: the engine is provider-agnostic, with no version-specific cases, and `packages/core/test/generated-models.test.ts` runs the same model-aware evaluation cases against the real `r4`, `r5` and `r6` providers ([T0039](T0039-fhir-r6-model.md)): typed navigation, choice types where the versions differ (`Observation.value[x]` allows `Reference` in R5 only and `Attachment` in R5 and R6), FHIR primitive conversion, and `is`/`as` with the types of each version, including the R6-only `DeviceAlert`. This is engine-tested provider support for a draft snapshot, not final R6 stability, an R6 conformance result (there is no official R6 suite, and none is invented) or a public model option (T0038). The suite exceptions above stay R4 and R5 only.

## Design notes

The `ModelProvider` interface and the type rules this task relies on (type-specifier resolution, FHIR primitive → System mapping, the model-less date convenience) are in [T0003](T0003-types-and-collections.md#design-notes).

### ModelNode

Data from the input is wrapped in a small `ModelNode`. It is a class, so V8 sees a single object shape:

```ts
class ModelNode {
  readonly value: unknown;            // JSON value; undefined for a primitive with only extensions
  readonly primitiveElement?: object; // the matching `_name` object (id/extension) for FHIR primitives
  readonly type?: ModelTypeInfo;      // undefined in model-less mode
  readonly systemType?: SystemTypeName; // what the model maps `type` to: 'Date' for FHIR.date
  readonly name: string;              // element name (for trace, pathname, children)
  readonly parent?: ModelNode;        // used for %resource, %rootResource and contained-reference resolution
  readonly index?: number;            // position in a repeating element
  systemValue(): SystemValue | undefined; // the converted value, computed once
}
```

Nodes are created lazily during navigation. Conversion to a System value (for example `FHIR.date` → `DateValue`) is memoized on the node: `systemValue()` computes it on first use, by `systemType` (`model/node-conversion.ts`), and `toSystemValue()` in the runtime calls it. A value that is not valid for its type keeps the plain JSON mapping ([spec notes](../spec-notes.md#typed-primitives-that-do-not-parse)). A `Quantity` converts only with a UCUM code, through `fromFhirQuantity()`.

### Choice types and primitive extensions

- **Choice elements** ([R5 §2.1.9.1.1](https://hl7.org/fhir/R5/fhirpath.html#polymorphism)): `Observation.value` looks up the JSON keys `value` + type suffix (`valueQuantity`, `valueString`, …) for each allowed type, and the node gets the type it matched and the element name `value`. Writing `Observation.valueQuantity` is not valid FHIRPath: it is a semantic error with a model (test `testPolymorphismB`, [T0024](T0024-static-analysis.md)) and empty at runtime. A `lenient: { choiceSuffix: true }` option accepts it for compatibility (test mode `lenient/polymorphics`), giving the value only when its type is the one the suffix names ([spec notes](../spec-notes.md#choice-elements-written-with-a-type-suffix)).
- **Primitive extensions** ([FHIR JSON](https://hl7.org/fhir/R4/json.html#primitive)): `birthDate` and `_birthDate` are merged into one node. Arrays are aligned by index, with `null` placeholders. A node exists when either part exists. `hasValue()` is false when only the extension exists, and such a node behaves as empty in System-typed operations: its System value is undefined, and `singleton()` treats it as empty wherever a specific type is expected (`Patient.active and true` and `Patient.active.not()` are empty), while `exists()`, `count()`, `is`, `as` and extension navigation still see the node.

### Navigation rules

1. With a model, `getElement(type, name)` decides what a name means for a node whose type is known. An unknown element is a semantic error when the analyzer knows the type. At runtime it is empty in normal mode and an error in strict mode (both [T0024](T0024-static-analysis.md)). The JSON keys that are not elements, including `resourceType`, are not navigable. A node the model does not know, such as an object with an unrecognized `resourceType`, is navigated like plain JSON, and never gets a type from its data.
2. `contained` resources and `Bundle.entry.resource` take their type from `resourceType`, falling back to the declared `Resource` when the model does not know it. In general, an element typed as a resource is typed by `getRootType()`.
3. **Root identifier as a type** ([N1 §10.1](https://hl7.org/fhirpath/N1/#models), [R5 §2.1.9.1](https://hl7.org/fhir/R5/fhirpath.html#rules), [spec notes](../spec-notes.md#root-identifiers-with-a-model)):
   - If the first identifier names a resource, complex or backbone type of the model and the input is of that type (or a subtype, as with `DomainResource`), it evaluates to the input.
   - If it names such a type and the input is of a different type, or has no model type, the result is empty in normal mode and a semantic error in strict mode.
   - Otherwise it is an ordinary path. A primitive type name (`id`, `code`, `date`) is always a path, because FHIR's elements use those names.
   - Without a model, an identifier that matches the input's `resourceType` is treated as the type name.
4. `navigateChildren()` ([T0017](T0017-fn-tree-utility.md) builds `children()` and `descendants()` on it) uses `getElements()` with a model and the JSON keys without one ([spec notes](../spec-notes.md#children-without-a-model)). Keys starting with `_` never appear as children: with a model they are folded into their primitives, and without one they are skipped, as is `resourceType`.
5. Variables are converted like the input, so a variable holding a resource is typed by the model.

### Lossless decimals in JSON input

`JSON.parse` turns `1.50` into `1.5`, which loses precision that FHIRPath can observe (`toString()`, `~`, `precision()`). Callis accepts ordinary parsed JSON, which is convenient but lossy. It also exports `parseJson(text)`, a small parser with no dependencies that keeps each numeric literal as a `JsonNumber` holding the source text (`model/lossless-json.ts`). Navigation understands both forms. The conformance runner uses the lossless path through the adapter's optional `parseInput(text)` hook in `tools/conformance/src/engine-adapter.ts`, set to `parseJson`. Without that hook the runner defaults to `JSON.parse` ([T0022: adapter interface](T0022-conformance-runner.md#adapter-interface), [#48](https://github.com/losol/callis/issues/48)).

- `parseJson()` accepts what [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259) allows, like `JSON.parse`, and raises `eval/invalid-json` otherwise. It is iterative, so nesting is not limited by the call stack, and a `__proto__` key becomes an own property.
- A `JsonNumber` has `text`, `toInteger()` (a number written without a fraction or exponent, in the 32-bit range), `toDecimal()` (the exact value, with the scale of the text; `9.5e2` is `950`), `toNumber()`, `valueOf()`, `toString()` and `toJSON()`, so JavaScript arithmetic and `JSON.stringify()` treat it as the number `JSON.parse` would have given.
- In a collection, a `JsonNumber` node is the Integer or Decimal its text denotes; a typed FHIR `decimal` is always a Decimal. Plain output gives that value (an Integer as a number, a Decimal by `decimalOutput`), while an object result keeps its `JsonNumber` values as they are.

## Acceptance criteria

- [x] `Observation.value.as(Quantity).unit` works, and so does `Observation.value is Quantity`; `ofType()` uses the same matching rule (`matchesTypeTarget()` with `'ofType'`) and arrives as a function with [T0042](T0042-fn-projection-completion.md). `Observation.valueQuantity` is empty by default (a semantic error with [T0024](T0024-static-analysis.md)), and works with `lenient.choiceSuffix`.
- [x] `Patient.name.given` on `["a", null]` with `_given: [null, {extension}]` gives two nodes, and the second has no System value, so it behaves as empty in System operations; `hasValue()` reads that once [T0020](T0020-fhir-functions.md) is merged.
- [x] With `parseJson`, `1.50` keeps its precision end to end: the typed value is the Decimal `1.50`, and `decimalOutput: 'string'` gives `'1.50'` (`toString()` is [T0014](T0014-fn-conversion.md)).
- [x] With the mini model, unknown `string1`, `System.Patient`, `FHIR.Boolean` and `Foo.Patient` raise `eval/unknown-type` across `is`/`as` (operator and function forms) and the `ofType()` matching rule; resolved mismatches remain false/empty. An object with an unrecognized `resourceType` does not bypass the provider. `testFHIRPathAsFunction23` passes; `24` needs `ofType()`. R4/R5 `testType22` is registered as the [documented suite exception](../spec-notes.md#unresolved-type-specifiers-are-execution-errors) in `tools/conformance/src/exceptions.ts`, together with `testFHIRPathAsFunction11`/`16` ([#111](https://github.com/losol/callis/issues/111)); the vendored fixtures and the unknown-type semantics are unchanged.
- [x] The same model-aware evaluation cases pass against the real `r4`, `r5` and `r6` providers in `packages/core/test/generated-models.test.ts`, with the engine free of version-specific code: typed navigation, the version-specific allowed types of `Observation.value[x]`, FHIR primitive conversion, `is`/`as` with each version's types, and the R6-only `DeviceAlert` as a type under R6 and as unknown data under R4 and R5. No R6 conformance result is claimed and no R6 suite exception is registered.
- [x] With the real R4 and R5 models, `testMiscellaneousAccessorTests` and `testQuantityUnitComparison` pass. `testBasics`, `testObservations`, `polymorphics` and `testInheritance` pass except for the tests that need other tasks: the semantic errors of `mode="strict"` (`testSimpleFail`, `testSimpleWithWrongContext`, `testPolymorphismB`, `testPolymorphismAsB`, `testPolymorphicsB`; [T0024](T0024-static-analysis.md)), `extension()` (`testFHIRPathIsFunction8`–`10`; [T0020](T0020-fhir-functions.md)) and `ofType()` (`testFHIRPathAsFunction17`–`24`; [T0042](T0042-fn-projection-completion.md)). `testPolymorphismIsA3` (`Observation.issued is instant` on an absent element) expects empty where Callis gives `false` for `is` on empty input, the [T0008 decision](../spec-notes.md#resource-type-names-without-a-model) this task does not change. The model parts of `testTypes` pass; its remaining failures are the conversion functions ([T0014](T0014-fn-conversion.md)).
