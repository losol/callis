# ADR-0007: UCUM: minimal unit system in core, full UCUM in `@callis/ucum`

- **Status:** Accepted (owner review, 2026-11-03)
- **Date:** 2026-11-03
- **Amended:** 2026-11-06, to record how the UCUM data is shipped (owner decision of 2026-11-05 in [T0007](../tasks/T0007-ucum.md#ucum-data-and-license), [#103](https://github.com/losol/callis/issues/103))

## Context

Full UCUM support needs a unit-expression parser and the UCUM tables (hundreds of units). `@lhncbc/ucum-lhc` is complete but large and has dependencies. The spec only requires implementations to respect units and recognize when they differ, but users expect `1 'kg' = 1000 'g'`.

## Decision

`@callis/core` defines `UnitSystem` and ships a minimal implementation (identical units, calendar and UCUM time units). `@callis/ucum` provides full conversion, with no runtime dependencies, as an opt-in. The owner chose the separate package over bundling UCUM in the core (2026-11-03), on condition that the UCUM data license is checked first.

After that check, the owner decided (2026-11-05) how the data is shipped: `@callis/ucum` contains the full `ucum-essence.xml` from a pinned upstream commit, unchanged, with its copyright notice and license, and parses it when it is first imported. The tables it builds exist only in memory at runtime; no table generated from the file is stored or distributed.

## Consequences

The core stays small and spec-conformant, but users must opt in to get general unit conversion (to be documented clearly). The essence file is under the [UCUM license](https://github.com/ucum-org/ucum/blob/main/LICENSE.md) (Regenstrief Institute), not MIT. Version 1.1 does not allow modifying it or creating derivative works, and asks for a copyright notice, a reference to the license and its disclaimer when the file is distributed whole. [T0007](../tasks/T0007-ucum.md#ucum-data-and-license) records the check, and why tables generated from the file were dropped. The package ships the file and those notices as recorded in [`packages/ucum/SOURCE.md`](../../packages/ucum/SOURCE.md) and [`UCUM-LICENSE.md`](../../packages/ucum/UCUM-LICENSE.md), and pays for it with parsing at startup ([T0007](../tasks/T0007-ucum.md#ucum-data-and-license) gives the measured size and import time). An update replaces the file with a newer unchanged upstream copy; a generator for UCUM tables is not part of the design.
