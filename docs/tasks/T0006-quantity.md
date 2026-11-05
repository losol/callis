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
- Quantity equality, equivalence and comparison kernels, and `+ - * /` kernels, all through the `UnitSystem`. The Decimal kernels they build on return `undefined` beyond the Decimal size bound ([T0004](T0004-decimal.md#design-notes)); the Quantity kernels and unit conversions then give empty too.
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
interface UnitProduct { readonly unit: string; readonly factor: Decimal; readonly divisor?: Decimal; }
interface UnitConversionOptions { readonly equivalence?: boolean; readonly explicit?: boolean; }
interface ParsedUnit { readonly unit: string; }
interface UnitSystem {
  /** Parse and validate a unit, or return undefined if it is unknown. */
  parse(unit: string): ParsedUnit | undefined;
  /** Optional exact comparison avoids rounding recurring conversion intermediates. */
  compare?(a: Decimal, from: string, b: Decimal, to: string): -1 | 0 | 1 | undefined;
  /** Convert a value between units, or return undefined if the dimensions differ. */
  convert(value: Decimal, from: string, to: string, options?: UnitConversionOptions): Decimal | undefined;
  /** Canonical form and numeric factor used by * and /, for example 'cm2' / 'cm' → 'cm'. */
  multiply(a: string, b: string): UnitProduct | undefined;
  divide(a: string, b: string): UnitProduct | undefined;
}
```

The UCUM tables are derived from data under the [UCUM license](https://github.com/ucum-org/ucum/blob/main/LICENSE.md) (Regenstrief Institute), which is not MIT. The owner made a license check a condition for `@callis/ucum`; [T0007](T0007-ucum.md) does it.

## Implementation contract

The value and kernels remain internal imports until T0025 selects package exports.
`UnitSystem.convert` takes an optional options object with an `equivalence` flag;
calendar years/months must not silently become definite durations for equality,
ordering or addition. Explicit conversion uses `explicit: true` (taking precedence
over equivalence): convert within the source code system and then relabel using the
target counterpart. Implicit time comparison first selects the least granular
magnitude and retains each operand's system; a calendar/UCUM year or month pair
remains incomparable even when one input originally used days or smaller units.
Terminating conversion ratios preserve every supported Decimal digit; only
recurring ratios use arithmetic division rounding for conversion results. Exact
comparison can use the optional `UnitSystem.compare` capability; the minimal
provider uses bounded rational cross-products without creating a rounded Decimal
intermediate. Providers with recurring conversions should implement this optional
capability; existing providers retain the conversion fallback. Providers return `undefined` for unsupported conversions
and Decimal overflow. Unit algebra returns a unit and a Decimal factor, so a
future UCUM provider can canonicalize scaled compound units without losing value.
The initial string-only algebra sketch cannot describe a scaled cancellation such
as `cm / m → 0.01 '1'`; returning only `'1'` would lose the factor. Returning
`UnitProduct { unit: string; factor: Decimal }` corrects that sketch before any
provider exists, and lets T0007 canonicalize compound units without a later break.
An optional Decimal `divisor` represents rational factors exactly (`s/min` is
`1/60`), so `60 's' / 1 'min'` remains exactly 1; ordinary providers omit it.
The divisor defaults to one; both scale components
must be strictly positive. Kernels apply exact multiplications before one final
division, and return empty for invalid scales or any Decimal intermediate overflow.
Affine conversions retain their offsets for values; granularity uses only the
interval delta. Providers must reject affine unit products/quotients. Calendar
quotients return empty, including identical calendar units; division by the UCUM
default unit `'1'` retains the calendar unit. UCUM time units can still cancel
([3.0.0 division](https://hl7.org/fhirpath/STU3/en/index.html#division)).
The alternative of retaining every input spelling in an unsimplified unit string
would force every consumer to parse composite units.

`ParsedUnit` exposes only its unit spelling; provider-specific metadata can be
added without forcing consumers to know dimension vectors or affine transforms.

For #53, `calendar-units.ts` owns quantity normalization and the calendar/UCUM
relationships. Date/time arithmetic keeps its independent table under the module
dependency rules. Cross-module tests in `packages/core/test/` must verify singular,
plural and fixed-duration aliases agree, and that `a`/`mo` remain rejected by
date/time arithmetic while FHIR mapping produces calendar year/month.

## Acceptance criteria

- [x] The 3.0.0 time-valued quantity table holds:
  - `1 year = 1 'a'` is empty (`testEquality36`)
  - `1 year ~ 1 'a'` is `true`
  - `7 days = 1 'wk'` is `true` (`testQuantity6`)
  - `1 second = 1 's'` is `true`
  - `10 seconds > 1 's'` is `true`
  - `1 year > 1 'a'` is empty
- [x] With the minimal unit system, units it does not know compare as empty, and no error is thrown.
- [x] The `UnitSystem` interface is documented and has a test double for other tasks to use.
