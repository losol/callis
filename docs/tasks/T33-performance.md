# T33 — Benchmarks and performance

Part of the [roadmap](../roadmap.md). Phase 3 · wave 8 · size L.

- **Depends on:** [T25](T25-public-api-release.md)

## Goal

Measure performance, compare it with other engines, and make targeted optimizations.

## Scope

- **Benchmarks:** a Vitest bench suite with a corpus of every FHIRPath expression from the R4/R5 search parameters and invariants, evaluated against example resources and bundles.
- **Baseline numbers:** compile time, sync evaluation, async evaluation with no-op hooks, and memory use.
- **Comparison:** against `fhirpath.js` (dev dependency only).
- **Optimizations backed by profiles, for example:**
  - closures specialized for sync-only use
  - a fast path for `Decimal` when values fit in a `number`
  - caching of navigation and type lookups
  - avoiding intermediate arrays
- **Tracking:** a non-blocking CI job that tracks benchmark trends.

## Acceptance criteria

The benchmark suite and its results are committed (`docs/performance.md`); each optimization PR shows a before/after comparison; there are no conformance regressions.
