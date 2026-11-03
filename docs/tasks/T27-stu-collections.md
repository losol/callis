# T27 — STU: collection additions

Part of the [roadmap](../roadmap.md). Phase 2 · wave 8 · size M.

- **Depends on:** [T25](T25-public-api-release.md)

## Goal

`sort([keySelector [asc|desc], …])`, `coalesce(…)`, `repeatAll(projection)`, `combine(other, preserveOrder)` and `pathname([short])`.

## Acceptance criteria

The spec examples are tests; `sort` is stable and reuses the T9 comparison kernel; conformance groups `testSort` and the STU parts of `testCombine()` pass.
