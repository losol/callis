# T12 — Functions: filtering and projection

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size M.

- **Depends on:** [T8](T08-compiler-evaluator.md), [T9](T09-equality-kernels.md)
- **Parallel with:** [T10](T10-operators.md), [T11](T11-fn-existence.md), [T13](T13-fn-subsetting-combining.md)–[T18](T18-model-aware-evaluation.md)

## Goal

[N1 §5.2](https://hl7.org/fhirpath/N1/#filtering-and-projection): `where`, `select`, `repeat`, `ofType`.

## Scope

- Lambda functions built on the T8 helpers.
- `repeat` deduplicates per the spec. That only guarantees termination for projections that navigate a finite input; a projection that generates values, such as `'x'.repeat($this & 'x')`, never runs out of new items. `repeat` therefore enforces `limits.maxRepeatItems` (with a finite default chosen and documented in this task) and raises `eval/limit-exceeded` ([architecture: security and robustness](../architecture.md#security-and-robustness)).
- `ofType` works with System types now, and with model types through the type-test API once T18 is merged.

## Acceptance criteria

- [ ] Each function is tested in sync and async mode, and `$this`/`$index` are correct in nested lambdas.
- [ ] `repeat` terminates on nested input structures (for example `Questionnaire.repeat(item)`).
- [ ] A value-generating projection (`'x'.repeat($this & 'x')`) stops with `eval/limit-exceeded` in both sync and async mode, within the default limit and within a custom `limits.maxRepeatItems`.
- [ ] Conformance groups: `testWhere`, `testSelect`, `testRepeat`.
