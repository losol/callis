# T0041 — Functions: remaining existence

Part of the [roadmap](../roadmap.md). Phase 1 · wave 6 · size S.

- **Depends on:** [T0011](T0011-fn-existence.md), [T0013](T0013-fn-subsetting-combining.md)
- **Area:** `area:functions`
- **Issue:** [#132](https://github.com/losol/callis/issues/132)
- **Background:** [T0009](T0009-equality-kernels.md), [T0038](T0038-public-api-completion.md)

## Goal

Complete [N1 §5.1](https://hl7.org/fhirpath/N1/#existence): `empty`, `all`, `allTrue`, `anyTrue`, `allFalse`, `anyFalse`, `subsetOf`, `supersetOf`, `distinct`, `isDistinct`.

## Scope

Preserve the remaining contract from the original T0011 after exists/count moved into the small 0.2 scope. Reuse the existing collection/equality/predicate contracts and retain the implemented exists/count behaviour. Child [T0044](T0044-fn-first-single.md) supplies first for the original subset/superset and count suite cases; T0013 remains the full-completion prerequisite; this is a real completion-test requirement, not an addition to 0.2. This completion task is not assigned to 0.2 by the split and has no promised release version or due date.

## Design

- All ten functions are in `functions/existence.ts`, next to `exists` and `count`. `all` is a lambda function and shares the short-circuiting criteria loop of `exists` (`findItem()`), so it keeps the canonical Boolean rule of `where`, nested `$this`/`$index` frames and the internal sync/async path. The other functions are value functions. No `area:core` file changes.
- `all` stops at the first item whose criterion does not match, as `exists` stops at a match ([spec notes](../spec-notes.md#all-stops-at-the-first-item-that-does-not-match)).
- `allTrue`, `anyTrue`, `allFalse` and `anyFalse` accept only Booleans, including FHIR `boolean` nodes; any other item raises `eval/type-mismatch` ([spec notes](../spec-notes.md#alltrue-and-the-like-take-only-booleans)).
- `subsetOf` and `supersetOf` use `includesEqual()` from `subsetting.ts`, the membership rule of `intersect` and `exclude`: only a `true` equality makes an item a member, as 3.0.0 clarifies.
- `distinct` keeps the last of equal items, in input order. Two items are equal only when `=` is true: false and empty both mean they are distinct, as 3.0.0 says, which is also the membership rule of `|`, `intersect` and `exclude`. So dates of different precision, quantities whose units cannot be related, an element that holds only extensions and complex values whose children cannot be compared all count as distinct, and `isDistinct` is never empty. The first implementation ([#202](https://github.com/losol/callis/pull/202)) followed the test suite and returned empty; the owner chose 3.0.0 on 2026-11-10 ([ADR-0001](../adr/0001-spec-baseline.md)). R5 `testDistinct29` and `testDistinct36`, which expect empty, are spec exceptions ([spec notes](../spec-notes.md#distinct-and-isdistinct)).

## Acceptance criteria

- [x] The spec examples for each remaining function are tests in `existence.test.ts`. The `allTrue`/`anyTrue`/`allFalse`/`anyFalse` examples project with `select()` ([T0042](T0042-fn-projection-completion.md)); until it is merged they run with the test-only `testSelect()`.
- [x] Undetermined equality (for example dates with different precision) counts as distinct, as 3.0.0 says: `@2020.combine(@2020-01-01).isDistinct()` is `true`, and `distinct()` keeps both dates.
- [x] Conformance groups `testAll`, `testSubSetOf`, `testSuperSetOf` and `testDistinct` pass, with complete original `testExists` and `testCount` coverage retained, including R4/R5 `testCount3`/`testCount4` once child [T0044](T0044-fn-first-single.md) supplies first. No missing-function case becomes a spec exception; the only exceptions in these groups are R5 `testDistinct29` and `testDistinct36`, which contradict 3.0.0. In R4 and R5, every test of these groups passes except four that also call `select()` ([T0042](T0042-fn-projection-completion.md)) and pass once it is merged: `testAllTrue1`, `testAllTrue2`, `testDistinct3` and `testDistinct6`.
- [x] Existing public behaviour, errors and internal sync/async predicate compatibility are preserved; conformance baseline never regresses.
