# T0004 — Decimal

Part of the [roadmap](../roadmap.md). Phase 1 · wave 1 · size M.

- **Depends on:** [T0000](T0000-scaffold.md)
- **Parallel with:** [T0001](T0001-lexer.md), [T0003](T0003-types-and-collections.md), [T0005](T0005-date-time.md), [T0022](T0022-conformance-runner.md)
- **Background:** [ADR-0005](../adr/0005-bigint-decimal.md)

## Goal

An exact, precision-preserving `Decimal` without dependencies ([design notes](#design-notes), [ADR-0005](../adr/0005-bigint-decimal.md)).

## Scope

- `src/values/decimal/`:
  - parse from literal or string text, and from `number` (shortest round-trip)
  - `toString()` that keeps the scale
  - `add`, `subtract`, `multiply`, `divide` (28 significant digits, at least 8 fractional digits, trailing zeros removed, empty on division by zero)
  - `div`, `mod`, `negate`, `abs`, `round(precision)` (half away from zero), `truncate`, `floor`, `ceiling`
  - `compare`, `equals` (trailing zeros ignored), `equivalent` (rounded to the less precise operand)
  - conversion to and from Integer
  - `sqrt`, `exp`, `ln`, `log` and `power`:
    - non-negative integer exponents are exact
    - negative integer exponents use reciprocal Decimal division (28 significant digits; a zero base gives empty)
    - other exponents go through `number`, rounded to 15 significant digits
- Property-based tests (`fast-check`) against `decimal.js`, which is a dev dependency only.

## Design notes

**Decision ([ADR-0005](../adr/0005-bigint-decimal.md)):** Callis implements its own `Decimal`, backed by `BigInt`, with no dependency.

```ts
class Decimal {                  // immutable
  readonly coefficient: bigint;  // value = coefficient × 10^-scale
  readonly scale: number;        // number of digits after the decimal point, ≥ 0
}
```

**Requirements** ([N1 §4.1.4](https://hl7.org/fhirpath/N1/#decimal)): at least 28 digits with 8 decimal places, a fixed-precision representation, and **visible precision**: `1.0.toString()` is `'1.0'`, and `~` and phase 2's `precision()`/`lowBoundary()` depend on the scale. A JavaScript `number` fails all of these (`0.1 + 0.2`, losing `1.0`, the 2^53 limit).

**Semantics**

- `+` and `-` are exact, with scale `max(a.scale, b.scale)`. `*` is exact, with scale `a.scale + b.scale`.
- `/` always returns a Decimal ([N1 §6.6.2](https://hl7.org/fhirpath/N1/#division)). The quotient is computed to 28 significant digits (at least 8 fractional digits) and trailing zeros are removed. Division by zero returns empty.
- `div`, `mod`, `round`, `truncate`, `floor`, `ceiling` and `abs` are exact. `round()` rounds half away from zero (`0.5 → 1`, `-0.5 → -1`), as clarified in [3.0.0](https://hl7.org/fhirpath/STU3/).
- `sqrt`, `exp`, `ln`, `log`, and `power` with a non-integer exponent go through `number` and `Math.*`, and the result is rounded to 15 significant digits. This precision loss is documented.
- `power` with an integer exponent:
  - With a **non-negative** exponent the result is exact (repeated multiplication on `BigInt`).
  - With a **negative** exponent the result cannot always be exact (`3.power(-1)` is 1/3). It is computed as the reciprocal `1 / x^|n|` using Decimal division: 28 significant digits, trailing zeros removed, and an empty result when `x` is zero (`0.power(-1)` is empty, like division by zero).
- Comparison aligns scales. Literals and parsed values keep their scale.
- A `number` from `JSON.parse` is converted through its shortest round-trip string. The original precision is already lost at that point, which is why [T0018: lossless decimals](T0018-model-aware-evaluation.md#lossless-decimals-in-json-input) offers a lossless JSON parser.
- The tests include property-based checks against `decimal.js`, used only as a dev-time oracle.

## Acceptance criteria

- [ ] `1.0.toString() = '1.0'`, `0.1 + 0.2 = 0.3`, `1.2 * 1.8 = 2.16`, `(1.2 / 1.8).round(2) = 0.67`, `1 / 2 = 0.5`, and `(-0.5).round() = -1` (3.0.0).
- [ ] `2.power(3) = 8` and `2.5.power(2) = 6.25` are exact, `2.power(-1) = 0.5`, `3.power(-1)` gives 28 significant digits, and `0.power(-1)` is empty.
- [ ] Property tests pass for add, subtract, multiply, divide and compare against the oracle (at least 1,000 runs each).
- [ ] No runtime dependency. Line coverage of `decimal/` is at least 95%.
