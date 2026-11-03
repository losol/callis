# ADR-0009: ESM-only packages without runtime dependencies

- **Status:** Accepted (owner review, 2026-11-03)
- **Date:** 2026-11-03

## Context

ESM is the standard in 2026, and Node ≥ 20.19 / 22.12 can `require()` ESM. A dual build (CJS + ESM) adds the dual-package hazard and more build and test surface. Zero dependencies simplifies auditing and use in browsers.

## Decision

Publish ESM only, targeting ES2022, with `sideEffects: false` (owner decision, 2026-11-03: no CommonJS build for now). `@callis/core` has no runtime dependencies; CI enforces this.

## Consequences

Consumers on old CommonJS toolchains (Node < 20.19, some Jest setups) cannot use Callis without a bundler. Adding a CJS build later is cheap with tsdown if there is demand.
