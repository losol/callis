# ADR-0005: Own BigInt-based Decimal

- **Status:** Accepted (pending owner review in the architecture PR)
- **Date:** 2026-11-03

## Context

FHIRPath needs exact decimals with visible precision (`1.0` vs `1.00`). The options:

- `decimal.js`: about 32 kB, global configuration, MIT
- `big.js`: about 6 kB, but normalizes away trailing zeros
- an own implementation on top of `BigInt`, which every target runtime supports

## Decision

Implement `Decimal` as `{ coefficient: bigint, scale: number }`, with exact `+ - * div mod` and rounding functions, division to 28 significant digits, and transcendental functions through `number` with documented precision.

## Consequences

No dependency and full control of scale semantics, at the cost of maintaining about 500 lines plus tests (a property-based oracle keeps that manageable). `BigInt` is slower than `number` for small values; a fast path can come later if benchmarks justify it.
