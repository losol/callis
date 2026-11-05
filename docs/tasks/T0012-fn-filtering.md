# T0012 — Functions: filtering and projection

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size M.

- **Depends on:** [T0008](T0008-compiler-evaluator.md), [T0009](T0009-equality-kernels.md)
- **Parallel with:** [T0010](T0010-operators.md), [T0011](T0011-fn-existence.md), [T0013](T0013-fn-subsetting-combining.md)–[T0018](T0018-model-aware-evaluation.md)

## Goal

[N1 §5.2](https://hl7.org/fhirpath/N1/#filtering-and-projection): `where`, `select`, `repeat`, `ofType`.

## Scope

- Lambda functions built on the T0008 helpers.
- `repeat` deduplicates per the spec. That only guarantees termination for projections that navigate a finite input; a projection that generates values, such as `'x'.repeat($this & 'x')`, never runs out of new items. `repeat` therefore enforces `limits.maxRepeatItems` (with a finite default chosen and documented in this task) and raises `eval/limit-exceeded` ([architecture: security and robustness](../architecture.md#security-and-robustness)).
- `ofType` works with System types and the [T0008 model-less resource-name matcher](T0008-compiler-evaluator.md#resource-type-names-without-a-model) now, and with model types through the type-test API once T0018 is merged. Reuse the same [target resolution and execution-error contract](T0008-compiler-evaluator.md#type-names-that-do-not-resolve) as `is`/`as`; preserve the existing FHIR primitive mapping distinction for `ofType()`.

## Acceptance criteria

- [ ] Each function is tested in sync and async mode, and `$this`/`$index` are correct in nested lambdas.
- [ ] `repeat` terminates on nested input structures (for example `Questionnaire.repeat(item)`).
- [ ] A value-generating projection (`'x'.repeat($this & 'x')`) stops with `eval/limit-exceeded` in both sync and async mode, within the default limit and within a custom `limits.maxRepeatItems`.
- [ ] `ofType(System.Patient)` and model-less `ofType(FHIR.Patient)` raise `eval/unknown-type`, including on empty input. A resolved nonmatching type gives empty. Without a model, `Bundle.entry.resource.ofType(Patient)` keeps only objects whose own `resourceType` equals `Patient`; absent/misspelled resource-name targets give empty ([#58](https://github.com/losol/callis/issues/58), [#59](https://github.com/losol/callis/issues/59)).
- [ ] Conformance groups: `testWhere`, `testSelect`, `testRepeat`.
