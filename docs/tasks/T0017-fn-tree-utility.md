# T0017 — Functions: tree navigation and utility

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size S.

- **Depends on:** [T0008](T0008-compiler-evaluator.md)
- **Area:** `area:functions`, `area:core`
- **Parallel with:** [T0010](T0010-operators.md)–[T0016](T0016-fn-math.md), [T0018](T0018-model-aware-evaluation.md)

## Goal

[N1 §5.8–5.9](https://hl7.org/fhirpath/N1/#tree-navigation): `children`, `descendants`, `trace(name[, projection])`, `now`, `timeOfDay`, `today`.

## Scope

- `children` and `descendants` are registered on `navigateChildren()` in `runtime/navigation.ts`, which [T0018](T0018-model-aware-evaluation.md) delivered: with a model, a typed node's elements in definition order, with `_name` extensions folded into their primitives; without one, the own JSON keys in document order ([spec notes](../spec-notes.md#children-without-a-model)).
- **FHIR versions** ([roadmap](../roadmap.md#fhir-versions)): the element order and names come from the provider, so the engine has no version-specific code. The model-aware cases also run against the real `r4`, `r5` and `r6` providers in `packages/core/test/generated-models.test.ts`, including an element that only some versions have (`Observation.triggeredBy` exists in R5 and R6, not in R4) and the recursive `Questionnaire.item.item`. R6 results are engine tests on the pinned draft, not conformance.
- `trace` sends events to the `trace` hook (a no-op by default). Until [T0021](T0021-hooks-async.md) adds the other hooks, the hook is the `hooks.trace` evaluate option of the internal API, and reaches the public API with [T0038](T0038-public-api-completion.md). It takes the event of the `EvaluationHooks.trace` sketch in [T0021: host hooks](T0021-hooks-async.md#host-hooks), `{ name, values, span }`, and extends the sketch in one point: where the sketch returns `void`, the hook may return a promise, which `evaluateAsync()` waits for and `evaluate()` rejects with `eval/async-in-sync`, as for every host hook ([ADR-0004](../adr/0004-sync-core-async-path.md)). [#185](https://github.com/losol/callis/issues/185) aligns the T0021 sketch with this. Passing it to the function needs a field in `EvalContext`, so the task also touches `area:core`. The name, the projection and the hook's results follow the [spec notes](../spec-notes.md#trace-names-and-projections).
- `now`, `today` and `timeOfDay` read the per-evaluation snapshot and honour the `now` and `timezoneOffset` options. By default they are computed in UTC ([ADR-0012](../adr/0012-evaluation-defaults.md)); `timezoneOffset: 'local'` uses the host's offset.

## Acceptance criteria

- [x] `now()` returns the same value when called twice within one evaluation, and the injected `now` is respected.
- [x] `_field` keys never appear as children. `descendants()` terminates and keeps document order ([spec notes](../spec-notes.md#order-of-descendants)).
- [x] With the real `r4`, `r5` and `r6` providers, `children()` gives each version's elements in definition order, so on an Observation whose JSON has a `triggeredBy` entry, `children()` includes it under R5 and R6 but not under R4, where it is not an element, and `descendants()` terminates on a nested `Questionnaire.item`. No R6 conformance result is claimed.
- [x] Conformance groups: `testTrace`, `testToday`, `testNow`. In R4 and R5, `testTrace1`, `testTrace2`, `testToday1` and `testNow1` pass. `testToday2` and `testNow2` also call `toString()` ([T0014](T0014-fn-conversion.md)) and `length()` ([T0015](T0015-fn-string.md)), and pass once those are merged.
