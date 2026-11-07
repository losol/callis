# T0013 — Functions: subsetting and combining

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size S.

- **Depends on:** [T0008](T0008-compiler-evaluator.md), [T0009](T0009-equality-kernels.md)
- **Parallel with:** [T0010](T0010-operators.md)–[T0012](T0012-fn-filtering.md), [T0014](T0014-fn-conversion.md)–[T0018](T0018-model-aware-evaluation.md)

## Goal

[N1 §5.3–5.4](https://hl7.org/fhirpath/N1/#subsetting): `single`, `first`, `last`, `tail`, `skip`, `take`, `intersect`, `exclude`, `union`, `combine`. The indexer was done in T0008.

## Acceptance criteria

- [ ] The spec examples are tests. `single()` on more than one item raises `eval/singleton-expected`.
- [ ] Conformance groups: `testSingle`, `testFirstLast`, `testTail`, `testSkip`, `testTake`, `testIntersect`, `testExclude`, `testUnion`, `testCombine()` (except the STU `preserveOrder` cases), and `testDollar` once T0012, T0042, T0015 and T0017 are merged (its `invalid="semantic"` case needs T0024 for a compile-time error; until then it counts as "detected late").
