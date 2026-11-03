# T7 — `@callis/ucum` package

Part of the [roadmap](../roadmap.md). Phase 1 · wave 3 · size L.

- **Depends on:** [T6](T06-quantity.md)
- **Parallel with:** [T8](T08-compiler-evaluator.md), [T9](T09-equality-kernels.md), [T23](T23-xml-fixture-conversion.md)
- **Background:** [ADR-0007](../adr/0007-ucum-split.md)

## Goal

Full UCUM unit conversion as an opt-in package with no runtime dependencies. The `UnitSystem` interface it implements, and the split between core and this package, are described in [T6 design notes](T06-quantity.md#design-notes).

## Scope

- `packages/ucum` (`@callis/ucum`), exporting a `UnitSystem` implementation named `ucum`.
- A generator script (`packages/ucum/scripts/`) that reads a pinned `ucum-essence.xml` and emits TypeScript tables: prefixes, base units, and derived units with exact `Decimal` factors and dimension vectors. The output is committed.
- A UCUM expression parser covering prefixes, atoms, exponents, `.` and `/`, `{annotations}` (ignored for conversion), `10*n` and `10^n`.
- Conversion and dimension analysis, canonical `multiply`/`divide`, and the special units `Cel` and `[degF]`. Other special units are reported as not convertible.
- A license notice for the UCUM data, as decided by the owner (see the open questions in architecture.md).

## Acceptance criteria

- [ ] `1 'kg' = 1000 'g'`, `1 'cm' < 1 'm'`, `12 'cm2' / 3 'cm' = 4.0 'cm'`, `1 'mg/dL'` converts to `'g/L'`, and `100 'Cel' > 50 '[degF]'`.
- [ ] Unknown or invalid units return `undefined` instead of throwing.
- [ ] No runtime dependency; the gzip size is reported in the PR.
- [ ] The conformance groups `testQuantity` and `testQuantityUnitComparison` pass once T10 is merged.
