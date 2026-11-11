# T0024b — Static analysis: strict mode

Part of the [roadmap](../roadmap.md). Phase 1 · wave 6 · size M.

- **Depends on:** [T0024a](T0024a-static-analysis-diagnostics.md)
- **Area:** `area:core`
- **Tier hint:** `risk:high`: the public `strict` option, so the core tier with a second reviewer from the other vendor.
- **Parallel with:** –
- **Parent:** [T0024](T0024-static-analysis.md), split on 2026-11-12.

## Goal

Level 3 of the [T0024 design notes](T0024-static-analysis.md#design-notes): strict mode ([N1 §11](https://hl7.org/fhirpath/N1/#type-safety-and-strict-evaluation)) on the type and cardinality inference of [T0024a](T0024a-static-analysis-diagnostics.md), including the order-dependent operations of [#72](https://github.com/losol/callis/issues/72).

## Scope

- The `strict` compile option, internal and public, off by default. It changes what compiles, never what an expression evaluates to ([spec notes](../spec-notes.md#strict-mode)).
- With `strict: true`, the analyzer reports as errors:
  - `semantic/singleton-expected`: a value whose cardinality is known to allow more than one item where an operator or function takes a single item (`Patient.name.given < 'X'`, `Patient.name.given.substring(1)`), from the `singleton` expectations the functions declare in `functions/define.ts`. Equality only in the narrower case §11 describes: one operand may repeat and the other is a single item (`Patient.name.given = 'Wouter'`); two collections (`Patient.name = Patient.name`) stay valid. A value of unknown cardinality, such as a path without a model, is never reported.
  - `semantic/type-mismatch`: the operator warnings of T0024a, a single value that is not a Boolean where one is expected (`testIif6`), and equality between two single items of types that are never equal.
  - `semantic/unordered-collection`: `first()`, `last()`, `tail()`, `skip()`, `take()` and the indexer on the result of `children()` or `descendants()`, or on what is derived from it item by item, whose order [N1 §3.1](https://hl7.org/fhirpath/N1/#collections) leaves undefined (`testDollarOrderNotAllowed`, [#72](https://github.com/losol/callis/issues/72)). The `ordered` expectation and hint in `functions/define.ts` carry what the functions know.
- Unknown types and ignored fractions stay warnings in strict mode.
- The conformance runner's adapter sets `strict` for `mode="strict"`.
- The runtime half of [T0018](T0018-model-aware-evaluation.md#navigation-rules)'s strict rule, an error for an element the model does not have when the type is known only at run time, is [#216](https://github.com/losol/callis/issues/216).

## Acceptance criteria

- [x] `testIif6` and `testDollarOrderNotAllowed` pass in R4 and R5, so every `invalid="semantic"` test in phase 1 passes.
- [x] In strict mode, `Patient.name.given < 'X'`, `Patient.name.given.substring(1)` and `Patient.name.given = 'Wouter'` are `semantic/singleton-expected` with `inputType: 'Patient'`; `Patient.name = Patient.name`, `Patient.name.given.first() = 'Wouter'` and `Patient.name.select(given.first() + ' ' + family)` are valid; nothing is reported without a model or an input type.
- [x] In strict mode, `first()`, `last()`, `tail()`, `skip()`, `take()` and the indexer on `children()` and `descendants()` are `semantic/unordered-collection`; `count()`, `where()`, `single()` and `exists()` on them are valid.
- [x] Unknown-type warnings do not become compile errors in strict mode, and the fraction warnings compile in strict mode too, with the same results as before.
- [x] The public `strict` option is accepted by `compile()`, `evaluate()` and `analyze()`, rejected when it is not a Boolean, and the cases above run against the real `r4`, `r5` and `r6` providers.
