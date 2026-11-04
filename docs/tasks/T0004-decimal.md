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

**Interface** (`src/values/decimal/`; not exported from `index.ts` yet, [T0025](T0025-public-api-release.md) decides the public API). `undefined` means an empty result.

```ts
// decimal.ts
class Decimal {
  static readonly ZERO: Decimal;
  static readonly ONE: Decimal;
  static of(coefficient: bigint, scale?: number): Decimal;  // also for Long (phase 2) and generated tables
  static parse(text: string): Decimal | undefined;          // (\+|-)?\d+(\.\d+)?, keeps the scale
  static fromNumber(value: number): Decimal | undefined;    // shortest round-trip; undefined for NaN/±Infinity
  static fromInteger(value: number): Decimal;               // implicit Integer → Decimal

  sign(): -1 | 0 | 1;
  isInteger(): boolean;                                     // 2.00 is
  toString(): string;                                       // keeps the scale, never exponent notation
  toNumber(): number;                                       // nearest number, for Math.* and plain output
  toInteger(): number | undefined;                          // whole values in the 32-bit Integer range

  add(other: Decimal): Decimal;
  subtract(other: Decimal): Decimal;
  multiply(other: Decimal): Decimal;
  divide(divisor: Decimal): Decimal | undefined;
  div(divisor: Decimal): Decimal | undefined;
  mod(divisor: Decimal): Decimal | undefined;
  negate(): Decimal;
  abs(): Decimal;
  round(precision?: number): Decimal;
  truncate(): Decimal;                                      // truncate, floor and ceiling have scale 0;
  floor(): Decimal;                                         // the math functions convert them with
  ceiling(): Decimal;                                       // toInteger(), Quantity keeps the Decimal
  compare(other: Decimal): -1 | 0 | 1;
  equals(other: Decimal): boolean;
  equivalent(other: Decimal): boolean;
}

// math.ts
function sqrt(value: Decimal): Decimal | undefined;
function exp(value: Decimal): Decimal | undefined;
function ln(value: Decimal): Decimal | undefined;
function log(value: Decimal, base: Decimal): Decimal | undefined;
function power(base: Decimal, exponent: Decimal): Decimal | undefined;
```

`of`, `fromInteger` and `round` throw `FhirPathEvaluationError` with the code `eval/invalid-argument` when an argument breaks their contract (a negative or fractional scale or precision, a fractional Integer). The function layer ([T0016](T0016-fn-math.md)) should check `round()`'s precision itself, so the error carries the expression's span.

**Requirements** ([N1 §4.1.4](https://hl7.org/fhirpath/N1/#decimal)): at least 28 digits with 8 decimal places, a fixed-precision representation, and **visible precision**: `1.0.toString()` is `'1.0'`, and `~` and phase 2's `precision()`/`lowBoundary()` depend on the scale. A JavaScript `number` fails all of these (`0.1 + 0.2`, losing `1.0`, the 2^53 limit).

**Semantics**

- `+` and `-` are exact, with scale `max(a.scale, b.scale)`. `*` is exact, with scale `a.scale + b.scale`.
- `/` always returns a Decimal ([N1 §6.6.2](https://hl7.org/fhirpath/N1/#division)). The quotient is computed to 28 significant digits (at least 8 fractional digits), rounded half away from zero, and trailing zeros are removed (`4 / 2` is `2`). Division by zero returns empty.
- `div`, `mod`, `round`, `truncate`, `floor`, `ceiling` and `abs` are exact. `div` truncates towards zero and has scale 0; `mod` has the sign of the dividend and scale `max(a.scale, b.scale)` (`-5.5 div 2 = -2`, `-5.5 mod 2 = -1.5`, as in the test suite).
- `round()` rounds half away from zero (`0.5 → 1`, `-0.5 → -1`), as clarified in [3.0.0](https://hl7.org/fhirpath/STU3/#fn-round). It never adds digits: `1.5.round(3)` is `1.5` ([spec notes](../spec-notes.md#round-never-adds-digits)).
- `sqrt`, `exp`, `ln`, `log`, and `power` with a non-integer exponent go through `number` and `Math.*`, and the result is rounded to 15 significant digits, with trailing zeros removed. This precision loss is documented. `ln` and `log` use `Math.log1p` on the exact `x − 1` when `x` is within 0.5 of 1, where rounding `x` to a number first would lose most of the digits. `NaN`, infinite results and underflow to zero give empty ([spec notes](../spec-notes.md#results-that-cannot-be-represented-are-empty)).
- `power` with an integer exponent (an exponent such as `2.0` counts as an integer):
  - With a **non-negative** exponent the result is exact (repeated multiplication on `BigInt`). If the exact power `|x|^|n|` would have more than 10,000 digits in its coefficient or its scale, it is treated as overflow and is empty; for a negative exponent this bounds the denominator.
  - With a **negative** exponent the result cannot always be exact (`3.power(-1)` is 1/3). It is computed as the reciprocal `1 / x^|n|` using Decimal division: 28 significant digits, trailing zeros removed, and an empty result when `x` is zero (`0.power(-1)` is empty, like division by zero).
- Comparison aligns scales. Literals and parsed values keep their scale.
- Equivalence rounds both values half away from zero to the precision of the less precise one, ignoring trailing zeros ([spec notes](../spec-notes.md#rounding-in-decimal-equivalence)).
- A `number` from `JSON.parse` is converted through its shortest round-trip string. The original precision is already lost at that point, which is why [T0018: lossless decimals](T0018-model-aware-evaluation.md#lossless-decimals-in-json-input) offers a lossless JSON parser.
- The tests include property-based checks against `decimal.js`, used only as a dev-time oracle.

## Acceptance criteria

- [ ] `1.0.toString() = '1.0'`, `0.1 + 0.2 = 0.3`, `1.2 * 1.8 = 2.16`, `(1.2 / 1.8).round(2) = 0.67`, `1 / 2 = 0.5`, and `(-0.5).round() = -1` (3.0.0).
- [ ] `2.power(3) = 8` and `2.5.power(2) = 6.25` are exact, `2.power(-1) = 0.5`, `3.power(-1)` gives 28 significant digits, and `0.power(-1)` is empty.
- [ ] Property tests pass for add, subtract, multiply, divide and compare against the oracle (at least 1,000 runs each).
- [ ] No runtime dependency. Line coverage of `decimal/` is at least 95%.
