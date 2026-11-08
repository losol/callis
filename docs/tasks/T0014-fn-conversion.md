# T0014 — Functions: conversion

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size M.

- **Depends on:** [T0008](T0008-compiler-evaluator.md)
- **Area:** `area:functions`
- **Parallel with:** [T0010](T0010-operators.md)–[T0013](T0013-fn-subsetting-combining.md), [T0015](T0015-fn-string.md)–[T0018](T0018-model-aware-evaluation.md)

## Goal

[N1 §5.5](https://hl7.org/fhirpath/N1/#conversion):

- `iif` (lazy: only the selected branch is evaluated)
- `toBoolean` and `convertsToBoolean`
- `toInteger` and `convertsToInteger`
- `toDecimal` and `convertsToDecimal`
- `toDate` and `convertsToDate`
- `toDateTime` and `convertsToDateTime`
- `toTime` and `convertsToTime`
- `toString` and `convertsToString`
- `toQuantity([unit])` and `convertsToQuantity([unit])`

## Scope

- With a model, the functions read the System value that [T0018](T0018-model-aware-evaluation.md) gives a typed FHIR primitive, the same for every provider ([FHIR versions](../roadmap.md#fhir-versions)). The R6 draft adds a FHIR note on `toString()` that limits it to FHIR primitives with a value ([§2.1.9.4.1](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#fn-toString)); check a typed FHIR `Quantity` against it and record any difference in `docs/spec-notes.md`.

## Acceptance criteria

- [ ] Each conversion table in N1 §5.5 is fully covered, including the string formats it accepts and rejects.
- [ ] `toString()` formats are tested: `1.0 → '1.0'`, `1 'wk'`, `1 week`, dates without `@`.
- [ ] Conformance groups: `testIif`, `testCollectionBoolean` (with T0010 for `|` and `/`), `testToInteger`, `testToDecimal`, `testToString`, and the conversion parts of `testLiterals` and `testTypes`.
