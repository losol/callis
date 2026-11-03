# T0030 — STU: precision, boundaries and date/time additions

Part of the [roadmap](../roadmap.md). Phase 2 · wave 8 · size L.

- **Depends on:** [T0025](T0025-public-api-release.md)

## Goal

- `lowBoundary`, `highBoundary` and `precision` for Decimal, Date, DateTime, Time and Quantity
- the component functions `yearOf` … `millisecondOf`, `timezoneOffsetOf`, `dateOf` and `timeOf`
- `duration` and `difference`
- `comparable`
- date/time subtraction
- the Quantity variants of `ceiling`, `floor`, `round` and `truncate`

## Acceptance criteria

Conformance groups `LowBoundary`, `HighBoundary`, `Precision` and `Comparable` pass; boundary semantics for timezones are documented in `spec-notes.md`.
