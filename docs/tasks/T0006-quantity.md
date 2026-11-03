# T0006 — Quantity and minimal unit system

Part of the [roadmap](../roadmap.md). Phase 1 · wave 2 · size M.

- **Depends on:** [T0004](T0004-decimal.md)
- **Parallel with:** [T0002](T0002-parser.md), [T0019](T0019-fhir-model-generator.md)
- **Conformance groups:** `testQuantity` (time units, with T0010)
- **Background:** [ADR-0007](../adr/0007-ucum-split.md)

## Goal

The `Quantity` value and the minimal built-in `UnitSystem` that core ships with ([design notes](#design-notes), [ADR-0007](../adr/0007-ucum-split.md)).

## Scope

- `src/values/quantity/`:
  - `Quantity { value: Decimal; unit }`, with calendar keywords normalized to singular
  - `toString()` (`1 'wk'`, `1 week`)
  - the `UnitSystem` interface
- The minimal implementation:
  - identical units
  - the UCUM time units `ms`, `s`, `min`, `h`, `d`, `wk`, `mo`, `a`
  - the calendar ↔ definite duration table as refined in [3.0.0](https://hl7.org/fhirpath/STU3/): `week`…`millisecond` are equal to `'wk'`…`'ms'`, while `year`/`month` are only equivalent to `'a'`/`'mo'` ([N1 §4.1.8](https://hl7.org/fhirpath/N1/#time-valued-quantities) is the original)
- Quantity equality, equivalence and comparison kernels, and `+ - * /` kernels, all through the `UnitSystem`.
- A helper that maps FHIR `Quantity` JSON to `System.Quantity` ([R5 §2.1.9.1.3](https://hl7.org/fhir/R5/fhirpath.html#quantity)).

## Design notes

`Quantity` is `{ value: Decimal; unit: string }`. The unit is either a UCUM code (from a string literal such as `'mg'`) or a calendar duration keyword. Plural keywords are normalized to singular. FHIR `Quantity` values are mapped as described in [T0003: type system](T0003-types-and-collections.md#type-system).

These operations need unit knowledge:

- equality, equivalence and ordering (conversion to a common unit)
- `+` and `-` (same dimension)
- `*` and `/` (unit algebra, as in `12 'cm2' / 3 'cm' = 4.0 'cm'`)
- `toQuantity(unit)`
- date/time arithmetic

**Decision ([ADR-0007](../adr/0007-ucum-split.md)):**

- **`@callis/core`** defines a `UnitSystem` interface and ships a **minimal built-in unit system**. It covers identical units, the calendar keywords, the UCUM time units `ms`, `s`, `min`, `h`, `d`, `wk`, `mo` and `a`, and the calendar ↔ definite duration table as refined in 3.0.0 (see [T0009: equality and equivalence](T0009-equality-kernels.md#equality-and-equivalence)). This meets the spec's minimum: implementations "must at least respect units, recognizing when units differ" ([N1 quantity equality](https://hl7.org/fhirpath/N1/#quantity-equality)). Units the minimal system cannot relate compare as empty.
- **`@callis/ucum`** is a separate package, also without runtime dependencies. It provides full UCUM conversion: a parser for UCUM unit expressions (prefixes, atoms, exponents, `.` and `/`, `{annotations}`, `10*n` factors) plus tables generated from [`ucum-essence.xml`](https://github.com/ucum-org/ucum), with exact `Decimal` factors and dimension vectors. A small, explicit set of special (non-ratio) units such as `Cel` and `[degF]` is supported; other special units report "not convertible". Users opt in with `compile(expr, { units: ucum })`. The conformance runner always uses it.

```ts
interface UnitSystem {
  /** Parse and validate a unit, or return undefined if it is unknown. */
  parse(unit: string): ParsedUnit | undefined;
  /** Convert a value between units, or return undefined if the dimensions differ. */
  convert(value: Decimal, from: string, to: string): Decimal | undefined;
  /** Canonical form used by * and /, for example 'cm2' / 'cm' → 'cm'. */
  multiply(a: string, b: string): string | undefined;
  divide(a: string, b: string): string | undefined;
}
```

The UCUM tables are derived from data under the [UCUM license](https://github.com/ucum-org/ucum/blob/main/LICENSE.md) (Regenstrief Institute), which is not MIT. The owner made a license check a condition for `@callis/ucum`; [T0007](T0007-ucum.md) does it.

## Acceptance criteria

- [ ] The 3.0.0 time-valued quantity table holds:
  - `1 year = 1 'a'` is empty (`testEquality36`)
  - `1 year ~ 1 'a'` is `true`
  - `7 days = 1 'wk'` is `true` (`testQuantity6`)
  - `1 second = 1 's'` is `true`
  - `10 seconds > 1 's'` is `true`
  - `1 year > 1 'a'` is empty
- [ ] With the minimal unit system, units it does not know compare as empty, and no error is thrown.
- [ ] The `UnitSystem` interface is documented and has a test double for other tasks to use.
