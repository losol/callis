# T11 — Functions: existence

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size S.

- **Depends on:** [T8](T08-compiler-evaluator.md), [T9](T09-equality-kernels.md)
- **Parallel with:** [T10](T10-operators.md), [T12](T12-fn-filtering.md)–[T18](T18-model-aware-evaluation.md)

## Goal

[N1 §5.1](https://hl7.org/fhirpath/N1/#existence): `empty`, `exists([criteria])`, `all`, `allTrue`, `anyTrue`, `allFalse`, `anyFalse`, `subsetOf`, `supersetOf`, `count`, `distinct`, `isDistinct`.

## Acceptance criteria

- [ ] The spec examples for each function are tests in `existence.test.ts`.
- [ ] Undetermined equality (for example dates with different precision) follows the test suite (`isDistinct()` / `distinct()` return empty).
- [ ] Conformance groups: `testExists`, `testAll`, `testSubSetOf`, `testSuperSetOf`, `testCount`, `testDistinct`.
