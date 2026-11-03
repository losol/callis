# ADR-0007: UCUM: minimal unit system in core, full UCUM in `@callis/ucum`

- **Status:** Accepted (pending owner review in the architecture PR)
- **Date:** 2026-11-03

## Context

Full UCUM support needs a unit-expression parser and the UCUM tables (hundreds of units). `@lhncbc/ucum-lhc` is complete but large and has dependencies. The spec only requires implementations to respect units and recognize when they differ, but users expect `1 'kg' = 1000 'g'`.

## Decision

`@callis/core` defines `UnitSystem` and ships a minimal implementation (identical units, calendar and UCUM time units). `@callis/ucum` provides full conversion from generated tables, with no runtime dependencies, as an opt-in.

## Consequences

The core stays small and spec-conformant, but users must opt in to get general unit conversion (to be documented clearly). The UCUM data license must be respected in `@callis/ucum` (see the open questions).
