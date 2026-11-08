# T0042 — Functions: projection and repeat

Part of the [roadmap](../roadmap.md). Phase 1 · wave 5 · size M.

- **Depends on:** [T0012](T0012-fn-filtering.md)
- **Issue:** [#133](https://github.com/losol/callis/issues/133)
- **Background:** [T0008](T0008-compiler-evaluator.md), [T0009](T0009-equality-kernels.md), [T0018](T0018-model-aware-evaluation.md), [T0038](T0038-public-api-completion.md)

## Goal

[N1 §5.2](https://hl7.org/fhirpath/N1/#filtering-and-projection): `select`, `repeat`, `ofType` completion. Filtering itself is delivered by the narrowed T0012.

## Scope

Preserve the original T0012 projection/repeat/type-filtering contract after where moved into the small 0.2 scope. This task has no selected release or due date. Existing where behaviour and all original acceptance below remain part of regression coverage.

- Lambda functions built on the T0008 helpers.
- `repeat` deduplicates per the spec. That only guarantees termination for projections that navigate a finite input; a projection that generates values, such as `'x'.repeat($this & 'x')`, never runs out of new items. `repeat` therefore enforces `limits.maxRepeatItems` (with a finite default chosen and documented in this task) and raises `eval/limit-exceeded` ([architecture: security and robustness](../architecture.md#security-and-robustness)).
- Implement `ofType` with System types and the [T0008 model-less resource-name matcher](T0008-compiler-evaluator.md#resource-type-names-without-a-model) using the existing type-test kernels, and with model types through the `matchesTypeTarget()` rule `'ofType'` that [T0018](T0018-model-aware-evaluation.md) delivered in `runtime/type-target.ts`. Reuse the same [target resolution and execution-error contract](T0008-compiler-evaluator.md#type-names-that-do-not-resolve) as `is`/`as`; preserve the existing FHIR primitive mapping distinction for `ofType()` ([spec notes](../spec-notes.md#fhir-primitives-in-is-as-and-oftype)).
- **FHIR versions** ([roadmap](../roadmap.md#fhir-versions)): the model-typed `ofType()` cases also run against the real `r4`, `r5` and `r6` providers in `packages/core/test/generated-models.test.ts`, with each version's allowed types for `Observation.value[x]` (`Reference` in R5 only, `Attachment` in R5 and R6) and the R6-only `DeviceAlert` as a type under R6 and an `eval/unknown-type` target under R4 and R5. The R6 draft's FHIR note on `ofType()` ([§2.1.9.4.2](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#fn-ofType2)) is the same as R5's. R6 results are engine tests on the pinned draft, not conformance.

## Acceptance criteria

- [ ] Each function is tested in sync and async mode, and `$this`/`$index` are correct in nested lambdas.
- [ ] `repeat` terminates on nested input structures (for example `Questionnaire.repeat(item)`).
- [ ] A value-generating projection (`'x'.repeat($this & 'x')`) stops with `eval/limit-exceeded` in both sync and async mode, within the default limit and within a custom `limits.maxRepeatItems`.
- [ ] `ofType(System.Patient)` and model-less `ofType(FHIR.Patient)` raise `eval/unknown-type`, including on empty input. A resolved nonmatching type gives empty. Without a model, `Bundle.entry.resource.ofType(Patient)` keeps only objects whose own `resourceType` equals `Patient`; absent/misspelled resource-name targets give empty ([#58](https://github.com/losol/callis/issues/58), [#59](https://github.com/losol/callis/issues/59)).
- [ ] With the real `r4`, `r5` and `r6` providers, `Observation.value.ofType(Reference)` and `ofType(Attachment)` follow each version's allowed types, and `Bundle.entry.resource.ofType(DeviceAlert)` keeps the alert under R6 and raises `eval/unknown-type` under R4 and R5. No R6 conformance result is claimed.
- [ ] Conformance groups: `testWhere`, `testSelect`, `testRepeat`, and the `ofType()` tests among `testFHIRPathAsFunction17`–`24` that T0018 left to this task, in R4 and R5 (`16` stays a [suite exception](../spec-notes.md#fhir-primitives-in-is-as-and-oftype)).
