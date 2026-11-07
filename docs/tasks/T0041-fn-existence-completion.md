# T0041 — Functions: remaining existence

Part of the [roadmap](../roadmap.md). Phase 1 · wave 6 · size S.

- **Depends on:** [T0011](T0011-fn-existence.md), [T0013](T0013-fn-subsetting-combining.md)
- **Issue:** [#132](https://github.com/losol/callis/issues/132)
- **Background:** [T0009](T0009-equality-kernels.md), [T0038](T0038-public-api-completion.md)

## Goal

Complete [N1 §5.1](https://hl7.org/fhirpath/N1/#existence): `empty`, `all`, `allTrue`, `anyTrue`, `allFalse`, `anyFalse`, `subsetOf`, `supersetOf`, `distinct`, `isDistinct`.

## Scope

Preserve the remaining contract from the original T0011 after exists/count moved into the small 0.2 scope. Reuse the existing collection/equality/predicate contracts and retain the implemented exists/count behaviour. Child [T0044](T0044-fn-first-single.md) supplies first for the original subset/superset and count suite cases; T0013 remains the full-completion prerequisite; this is a real completion-test requirement, not an addition to 0.2. This completion task is not assigned to 0.2 by the split and has no promised release version or due date.

## Acceptance criteria

- [ ] The spec examples for each remaining function are tests in `existence.test.ts`.
- [ ] Undetermined equality (for example dates with different precision) follows the test suite (`isDistinct()` / `distinct()` return empty).
- [ ] Conformance groups `testAll`, `testSubSetOf`, `testSuperSetOf` and `testDistinct` pass, with complete original `testExists` and `testCount` coverage retained, including R4/R5 `testCount3`/`testCount4` once child [T0044](T0044-fn-first-single.md) supplies first. No missing-function case becomes a spec exception.
- [ ] Existing public behaviour, errors and internal sync/async predicate compatibility are preserved; conformance baseline never regresses.
