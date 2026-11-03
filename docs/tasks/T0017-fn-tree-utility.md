# T0017 — Functions: tree navigation and utility

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size S.

- **Depends on:** [T0008](T0008-compiler-evaluator.md)
- **Parallel with:** [T0010](T0010-operators.md)–[T0016](T0016-fn-math.md), [T0018](T0018-model-aware-evaluation.md)

## Goal

[N1 §5.8–5.9](https://hl7.org/fhirpath/N1/#tree-navigation): `children`, `descendants`, `trace(name[, projection])`, `now`, `timeOfDay`, `today`.

## Scope

- `children` and `descendants` work model-less here; model-aware ordering arrives with T0018.
- `trace` sends events to the `trace` hook (a no-op by default).
- `now`, `today` and `timeOfDay` read the per-evaluation snapshot and honour the `now` and `timezoneOffset` options.

## Acceptance criteria

- [ ] `now()` returns the same value when called twice within one evaluation, and the injected `now` is respected.
- [ ] `_field` keys never appear as children. `descendants()` terminates and keeps document order.
- [ ] Conformance groups: `testTrace`, `testToday`, `testNow`.
