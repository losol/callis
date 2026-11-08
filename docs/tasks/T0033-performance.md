# T0033 — Benchmarks and performance

Part of the [roadmap](../roadmap.md). Phase 3 · wave 8 · size L.

- **Depends on:** [T0038](T0038-public-api-completion.md)

## Goal

Measure performance, compare it with other engines, and make targeted optimizations.

## Scope

- **Benchmarks:** a Vitest bench suite with a corpus of every FHIRPath expression from the R4, R5 and R6 search parameters and invariants, evaluated against example resources and bundles with the matching provider (`r4`, `r5`, `r6`). The R6 corpus comes from the pinned `6.0.0-snapshot1` archive ([T0039](T0039-fhir-r6-model.md#pinned-source-and-maturity)), and its results are labelled as draft R6 ([FHIR versions](../roadmap.md#fhir-versions)). Expressions that fail to compile because a function is not implemented yet are listed, not dropped silently.
- **Model cost:** the import time and memory of each model package, so users can compare `@callis/fhir-r4`, `-r5` and `-r6`.
- **Baseline numbers:** compile time, sync evaluation, async evaluation with no-op hooks, and memory use.
- **Comparison:** against `fhirpath.js` (dev dependency only).
- **Optimizations backed by profiles, for example:**
  - closures specialized for sync-only use
  - a fast path for `Decimal` when values fit in a `number`
  - caching of navigation and type lookups
  - avoiding intermediate arrays
- **Tracking:** a non-blocking CI job that tracks benchmark trends.

## Acceptance criteria

The benchmark suite and its results are committed (`docs/performance.md`), per FHIR version, with R6 marked as the pinned draft; each optimization PR shows a before/after comparison; there are no conformance regressions.
