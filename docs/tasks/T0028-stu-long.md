# T0028 — STU: `Long` type

Part of the [roadmap](../roadmap.md). Phase 2 · wave 8 · size M.

- **Depends on:** [T0038](T0038-public-api-completion.md)

## Goal

- `System.Long` (`bigint`) and the `L` literal suffix in the lexer and parser
- `toLong` and `convertsToLong`
- arithmetic and comparison
- implicit conversions (`Integer → Long → Decimal`)
- mapping `FHIR.integer64` to `System.Long`. R5 and the R6 draft have `integer64` and R4 does not; the generated `r5` and `r6` providers already map it to `Long` ([T0019](T0019-fhir-model-generator.md), [T0039](T0039-fhir-r6-model.md)), and its JSON value is a string.

## Acceptance criteria

The spec examples are tests; overflow behaviour is documented; Long tests in the suite pass; an `integer64` element evaluates as a `Long` with the real `r5` and `r6` providers ([FHIR versions](../roadmap.md#fhir-versions)), with no R6 conformance claim.
