# T0011 — Functions: existence

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size S.

- **Depends on:** [T0008](T0008-compiler-evaluator.md), [T0009](T0009-equality-kernels.md)
- **Parallel with:** [T0010](T0010-operators.md), [T0012](T0012-fn-filtering.md)–[T0018](T0018-model-aware-evaluation.md)

## Goal

[N1 §5.1](https://hl7.org/fhirpath/N1/#existence): `empty`, `exists([criteria])`, `all`, `allTrue`, `anyTrue`, `allFalse`, `anyFalse`, `subsetOf`, `supersetOf`, `count`, `distinct`, `isDistinct`.

## Acceptance criteria

- [ ] The spec examples for each function are tests in `existence.test.ts`.
- [ ] Undetermined equality (for example dates with different precision) follows the test suite (`isDistinct()` / `distinct()` return empty).
- [ ] Conformance groups: `testExists`, `testAll`, `testSubSetOf`, `testSuperSetOf`, `testCount`, `testDistinct`.
