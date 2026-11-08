# T0027 — STU: collection additions

Part of the [roadmap](../roadmap.md). Phase 2 · wave 8 · size M.

- **Depends on:** [T0038](T0038-public-api-completion.md)
- **Area:** `area:functions`

## Goal

`sort([keySelector [asc|desc], …])`, `coalesce(…)`, `repeatAll(projection)`, `combine(other, preserveOrder)` and `pathname([short])`.

## Acceptance criteria

The spec examples are tests; `sort` is stable and reuses the T0009 comparison kernel; conformance groups `testSort` and the STU parts of `testCombine()` pass.
