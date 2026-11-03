# ADR-0007: UCUM: minimal unit system in core, full UCUM in `@callis/ucum`

- **Status:** Accepted (owner review, 2026-11-03)
- **Date:** 2026-11-03

## Context

Full UCUM support needs a unit-expression parser and the UCUM tables (hundreds of units). `@lhncbc/ucum-lhc` is complete but large and has dependencies. The spec only requires implementations to respect units and recognize when they differ, but users expect `1 'kg' = 1000 'g'`.

## Decision

`@callis/core` defines `UnitSystem` and ships a minimal implementation (identical units, calendar and UCUM time units). `@callis/ucum` provides full conversion from generated tables, with no runtime dependencies, as an opt-in. The owner chose the separate package over bundling UCUM in the core (2026-11-03), on condition that the UCUM data license is checked first.

## Consequences

The core stays small and spec-conformant, but users must opt in to get general unit conversion (to be documented clearly). The tables are derived from `ucum-essence.xml`, which is under the [UCUM license](https://github.com/ucum-org/ucum/blob/main/LICENSE.md) (Regenstrief Institute), not MIT. [T0007](../tasks/T0007-ucum.md) must check that redistributing derived tables next to MIT code is allowed, document the result and include the required notice. `@callis/ucum` is not published until that check has passed.
