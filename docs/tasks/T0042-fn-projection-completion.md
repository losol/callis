# T0042 — Functions: projection and repeat

Part of the [roadmap](../roadmap.md). Phase 1 · wave 5 · size M.

- **Depends on:** [T0012](T0012-fn-filtering.md)
- **Area:** `area:functions`
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

## Design

- `select`, `repeat` and `ofType` are in `functions/filtering.ts`, next to `where` ([N1 §5.2](https://hl7.org/fhirpath/N1/#filtering-and-projection)). `select` and `repeat` are lambda functions on the internal sync/async path; `ofType` takes a type argument, resolved at compile time, and reuses `assertResolved()` and `matchesTypeTarget(…, 'ofType')` from `runtime/type-target.ts`.
- `repeat` follows 3.0.0's queue, so its result is breadth first. An item is found when `=` is true for an item of the result, so undetermined comparisons are new, as for `|`, or when it is the same input node (`isSameNode()` in `runtime/node-value.ts`), so an element that holds only extensions, which `=` cannot compare, is found once and a walk back to it ends. The projection is bound with `forInput()` for one item at a time: 3.0.0 does not set `$index` there, so it stays that of the call ([spec notes](../spec-notes.md#repeat)).
- **Limit:** `limits.maxRepeatItems` defaults to 5,000 (`DEFAULT_LIMITS` in `api/compile.ts`). `repeat` compares each new item with every item found, so a tree of thousands of complex items already takes seconds to deduplicate; at 5,000 a value-generating projection stops within a fraction of a second. The internal `EvaluateOptions.limits` option has the shape of T0038's `EvaluationLimits`; it is checked for every evaluation (a positive integer, otherwise `eval/invalid-argument`) and resolved into `EvalContext.limits`. The public facade gets the option with [T0038](T0038-public-api-completion.md#public-api-sketch). `limits.maxCollectionSize`, and with it [#186](https://github.com/losol/callis/issues/186) (`descendants()` on cyclic input), are not part of this task.
- The `area:core` changes are that option and field, in `api/compile.ts`, `runtime/context.ts` and the two tests that build an `EvalContext` by hand, and `isSameNode()` in `runtime/node-value.ts`.

## Acceptance criteria

- [x] Each function is tested in sync and async mode, and `$this`/`$index` are correct in nested lambdas.
- [x] `repeat` terminates on nested input structures (for example `Questionnaire.repeat(item)`).
- [x] A value-generating projection (`'x'.repeat($this & 'x')`) stops with `eval/limit-exceeded` in both sync and async mode, within the default limit and within a custom `limits.maxRepeatItems`.
- [x] `ofType(System.Patient)` and model-less `ofType(FHIR.Patient)` raise `eval/unknown-type`, including on empty input. A resolved nonmatching type gives empty. Without a model, `Bundle.entry.resource.ofType(Patient)` keeps only objects whose own `resourceType` equals `Patient`; absent/misspelled resource-name targets give empty ([#58](https://github.com/losol/callis/issues/58), [#59](https://github.com/losol/callis/issues/59)).
- [x] With the real `r4`, `r5` and `r6` providers, `Observation.value.ofType(Reference)` and `ofType(Attachment)` follow each version's allowed types, and `Bundle.entry.resource.ofType(DeviceAlert)` keeps the alert under R6 and raises `eval/unknown-type` under R4 and R5. No R6 conformance result is claimed.
- [x] Conformance groups: `testWhere`, `testSelect`, `testRepeat`, and the `ofType()` tests among `testFHIRPathAsFunction17`–`24` that T0018 left to this task, in R4 and R5 (`16` stays a [suite exception](../spec-notes.md#fhir-primitives-in-is-as-and-oftype)). The tests of other groups that waited for `select()` pass too: `testAllTrue1`, `testAllTrue2`, `testDistinct3` and `testDistinct6` ([T0041](T0041-fn-existence-completion.md)), and `testUnion9`–`11` ([T0013](T0013-fn-subsetting-combining.md)).
