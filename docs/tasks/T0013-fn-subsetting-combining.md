# T0013 — Functions: subsetting and combining

Part of the [roadmap](../roadmap.md). Phase 1 · wave 5 · size S.

- **Depends on:** [T0008](T0008-compiler-evaluator.md), [T0009](T0009-equality-kernels.md), [T0044](T0044-fn-first-single.md)
- **Issue:** [#25](https://github.com/losol/callis/issues/25)
- **Child:** [T0044](T0044-fn-first-single.md) / [#141](https://github.com/losol/callis/issues/141) (first and single)
- **Parallel with:** [T0010](T0010-operators.md)–[T0012](T0012-fn-filtering.md), [T0014](T0014-fn-conversion.md)–[T0018](T0018-model-aware-evaluation.md)

## Goal

[N1 §5.3–5.4](https://hl7.org/fhirpath/N1/#subsetting): `last`, `tail`, `skip`, `take`, `intersect`, `exclude`, `union`, `combine`. The indexer was done in T0008.

## Parent completion contract

This stable parent retains the original ten-function scope: first and single are delivered by child T0044; the eight functions listed above remain here. The original acceptance below applies to the complete parent, including regression coverage for the child. Keep #25 open after the child merges; a child implementation PR uses `Task: T0044` and closes only #141. Close the parent only after all remaining functions and original criteria are fulfilled.

T0044 depends on the already delivered evaluator and equality kernels, not this parent. This parent depends on the child for completion. Existing callers that need only first/single can depend on T0044; full completion dependencies in T0041 and T0038 continue to target T0013. Neither task has a selected release, milestone or due date.

## Acceptance criteria

- [ ] The spec examples are tests. `single()` on more than one item raises `eval/singleton-expected`.
- [ ] Conformance groups: `testSingle`, `testFirstLast`, `testTail`, `testSkip`, `testTake`, `testIntersect`, `testExclude`, `testUnion`, `testCombine()` (except the STU `preserveOrder` cases), and `testDollar` once T0012, T0042, T0015 and T0017 are merged (its `invalid="semantic"` case needs T0024 for a compile-time error; until then it counts as "detected late").
