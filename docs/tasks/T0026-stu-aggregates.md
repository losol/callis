# T0026 — STU: aggregates and variables

Part of the [roadmap](../roadmap.md). Phase 2 · wave 8 · size M.

- **Depends on:** [T0038](T0038-public-api-completion.md)
- **Area:** `area:functions`, `area:core`

## Goal

`$total`, `aggregate(aggregator[, init])` ([N1 §7](https://hl7.org/fhirpath/N1/#aggregates)), `sum`, `min`, `max`, `avg`, and `defineVariable(name[, value])` with 3.0.0 scoping rules.

## Acceptance criteria

The spec examples are tests; using `$total` outside `aggregate` is a semantic error; conformance groups `testAggregate` and `defineVariable` (R5 suite only) pass.
