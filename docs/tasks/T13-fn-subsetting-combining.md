# T13 — Functions: subsetting and combining

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size S.

- **Depends on:** [T8](T08-compiler-evaluator.md), [T9](T09-equality-kernels.md)
- **Parallel with:** [T10](T10-operators.md)–[T12](T12-fn-filtering.md), [T14](T14-fn-conversion.md)–[T18](T18-model-aware-evaluation.md)

## Goal

[N1 §5.3–5.4](https://hl7.org/fhirpath/N1/#subsetting): `single`, `first`, `last`, `tail`, `skip`, `take`, `intersect`, `exclude`, `union`, `combine`. The indexer was done in T8.

## Acceptance criteria

- [ ] The spec examples are tests. `single()` on more than one item raises `eval/singleton-expected`.
- [ ] Conformance groups: `testSingle`, `testFirstLast`, `testTail`, `testSkip`, `testTake`, `testIntersect`, `testExclude`, `testUnion`, `testCombine()` (except the STU `preserveOrder` cases), and `testDollar` once T12, T15 and T17 are merged (its `invalid="semantic"` case needs T24 for a compile-time error; until then it counts as "detected late").
