# @callis/core

## 0.2.0

### Minor Changes

- ac436db: Add `exists([criteria])` and `count()` to the synchronous model-less evaluator. Existence criteria reuse the established filtering predicate rules and stop at the first match. Empty collections return false for existence and zero for count; no public API options or async surface are added.
- 391ed2a: Add `where(criteria)` to the synchronous model-less evaluator. Filtering preserves order and input identity, supports nested item/index criteria, and follows the existing singleton Boolean and error rules without adding public API options.

## 0.1.0

### Minor Changes

- 049b205: Implement equality, equivalence, ordering, arithmetic, union and membership operators. Arithmetic preserves Decimal precision, enforces Integer bounds, supports Quantity unit conversion and calendar date/time quantities, and returns empty for numeric overflow or division by zero. Remove the temporary `eval/not-implemented` operator error code.
- 344d7e8: Export `Decimal`, `MAX_DECIMAL_DIGITS`, the `UnitSystem` contract types (`ParsedUnit`, `UnitConversionOptions`, `UnitProduct`, `UnitSystem`) and `minimalUnitSystem`, so that unit packages such as `@callis/ucum` can implement and extend the unit system.
- 95cf7fd: Add the internal equality, equivalence and ordering kernels behind `=`, `!=`, `~`, `!~`, `<`, `<=`, `>` and `>=`, with implicit Integer → Decimal, number → Quantity and Date → DateTime conversions, recursive comparison of complex JSON values, a hook for model-specific equivalence, and the model-less date convenience that reads input strings as dates when they are compared with a date/time. The operators that use them follow with the evaluator.
- e2c7274: Add internal Quantity values, minimal calendar and UCUM time-unit conversion,
  quantity comparison and arithmetic kernels, and FHIR Quantity mapping.
- 44b1ac6: Add the internal FHIRPath parser and readonly syntax tree, with exact literal text, source spans, qualified type names and bounded nesting. The public parse entry point will follow with the public API.
- da7c6f7: Add synchronous model-less `compile` and `evaluate` exports, plain result options and public error types. Use `decimalOutput: 'string'` to preserve exact evaluator Decimal and Quantity magnitudes. Existing model and unit-provider exports remain available. Broader function groups, model-aware evaluation and async APIs are deferred.
- cc25fd7: Export the `ModelProvider`, `ModelTypeInfo`, `ModelTypeKind`, `ElementInfo` and `SystemTypeName` types. A data model, such as the generated FHIR R4 and R5 models, implements `ModelProvider` to give the engine type-directed navigation and model-aware `is`, `as` and `ofType()`.

### Patch Changes

- 0bf76ff: Include the full MIT implementation license in the core and FHIR provider tarballs, preserving FHIR source notices and UCUM licensing. Include generated changelogs in all four package archives. Clarify the first 0.1 public subset and current UCUM integration in package documentation.
- 4730457: Add a README for npm and the `homepage` and `bugs` links to the package metadata.

## 0.1.0-next.0

### Minor Changes

- cc25fd7: Export the `ModelProvider`, `ModelTypeInfo`, `ModelTypeKind`, `ElementInfo` and `SystemTypeName` types. A data model, such as the generated FHIR R4 and R5 models, implements `ModelProvider` to give the engine type-directed navigation and model-aware `is`, `as` and `ofType()`.

### Patch Changes

- 4730457: Add a README for npm and the `homepage` and `bugs` links to the package metadata.
