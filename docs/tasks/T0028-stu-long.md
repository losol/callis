# T0028 — STU: `Long` type

Part of the [roadmap](../roadmap.md). Phase 2 · wave 8 · size M.

- **Depends on:** [T0038](T0038-public-api-completion.md)

## Goal

- `System.Long` (`bigint`) and the `L` literal suffix in the lexer and parser
- `toLong` and `convertsToLong`
- arithmetic and comparison
- implicit conversions (`Integer → Long → Decimal`)
- mapping `FHIR.integer64` (R5) to `System.Long`

## Acceptance criteria

The spec examples are tests; overflow behaviour is documented; Long tests in the suite pass.
