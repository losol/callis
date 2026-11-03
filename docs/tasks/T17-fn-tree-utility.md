# T17 — Functions: tree navigation and utility

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size S.

- **Depends on:** [T8](T08-compiler-evaluator.md)
- **Parallel with:** [T10](T10-operators.md)–[T16](T16-fn-math.md), [T18](T18-model-aware-evaluation.md)

## Goal

[N1 §5.8–5.9](https://hl7.org/fhirpath/N1/#tree-navigation): `children`, `descendants`, `trace(name[, projection])`, `now`, `timeOfDay`, `today`.

## Scope

- `children` and `descendants` work model-less here; model-aware ordering arrives with T18.
- `trace` sends events to the `trace` hook (a no-op by default).
- `now`, `today` and `timeOfDay` read the per-evaluation snapshot and honour the `now` and `timezoneOffset` options.

## Acceptance criteria

- [ ] `now()` returns the same value when called twice within one evaluation, and the injected `now` is respected.
- [ ] `_field` keys never appear as children. `descendants()` terminates and keeps document order.
- [ ] Conformance groups: `testTrace`, `testToday`, `testNow`.
