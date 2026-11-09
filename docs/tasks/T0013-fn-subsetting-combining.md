# T0013 — Functions: subsetting and combining

Part of the [roadmap](../roadmap.md). Phase 1 · wave 5 · size S.

- **Depends on:** [T0008](T0008-compiler-evaluator.md), [T0009](T0009-equality-kernels.md), [T0044](T0044-fn-first-single.md)
- **Area:** `area:functions`
- **Issue:** [#25](https://github.com/losol/callis/issues/25)
- **Child:** [T0044](T0044-fn-first-single.md) / [#141](https://github.com/losol/callis/issues/141) (first and single)

## Goal

[N1 §5.3–5.4](https://hl7.org/fhirpath/N1/#subsetting): `last`, `tail`, `skip`, `take`, `intersect`, `exclude`, `union`, `combine`. The indexer was done in T0008.

## Parent completion contract

This stable parent retains the original ten-function scope: first and single are delivered by child T0044; the eight functions listed above remain here. The original acceptance below applies to the complete parent, including regression coverage for the child. Keep #25 open after the child merges; a child implementation PR uses `Task: T0044` and closes only #141. Close the parent only after all remaining functions and original criteria are fulfilled.

T0044 depends on the already delivered evaluator and equality kernels, not this parent. This parent depends on the child for completion. Existing callers that need only first/single can depend on T0044; full completion dependencies in T0041 and T0038 continue to target T0013. Neither task has a selected release, milestone or due date.

## Design

- `last`, `tail`, `skip`, `take`, `intersect` and `exclude` are in `functions/subsetting.ts`, next to `first` and `single`; `union` and `combine` are in `functions/combining.ts`. All are value functions: the evaluator passes `other` and `num` evaluated, with the focus of the call ([spec notes](../spec-notes.md#function-arguments-are-evaluated-with-the-focus-of-the-call)).
- Every function returns the input items themselves, so object identity, model type and model-less date provenance survive. `union()` is the `|` operator (`BINARY_OPERATIONS['|']`), as the spec calls them synonymous; `intersect()` and `exclude()` use the same `itemEquals()` kernel, and `combine()` uses `concat()`. No `area:core` file changes.
- The decisions the spec leaves open are in the [spec notes](../spec-notes.md#subsetting-and-combining): an empty `skip()` or `take()` count gives empty, an undetermined equality is not equal, and the order of every result is fixed.
- `combine(other)` takes one argument; the STU `preserveOrder` is [T0027](T0027-stu-collections.md), which adds it as an optional parameter.

## Acceptance criteria

- [x] The spec examples are tests. `single()` on more than one item raises `eval/singleton-expected`.
- [x] Conformance groups: `testSingle`, `testFirstLast`, `testTail`, `testSkip`, `testTake`, `testIntersect`, `testExclude`, `testUnion`, `testCombine()` (except the STU `preserveOrder` cases), and `testDollar` once T0012, T0042, T0015 and T0017 are merged (its `invalid="semantic"` case needs T0024 for a compile-time error; until then it counts as "detected late"). In R4 and R5, every test of these groups passes except those that call a function of another task, which pass once that task is merged:
  - `empty()` ([T0041](T0041-fn-existence-completion.md)): `testSkip7`, `testSkip8`, `testTake8`, `testTake9`, `testIntersect2` and `testIntersect3`; the unit tests check the same results without `empty()`.
  - `isDistinct()` (T0041): `testCombine1`.
  - `select()` ([T0042](T0042-fn-projection-completion.md)): `testUnion9`, `testUnion10` and `testUnion11`; the unit tests check the same arguments inside `where()`.
  - `testDollarOrderNotAllowed` expects a semantic error for `Patient.children().skip(1)` in strict mode ([T0024](T0024-static-analysis.md)); the evaluator gives a result instead, so it does not even count as "detected late".
