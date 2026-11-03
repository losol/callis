# ADR-0011: HL7 test suite as the conformance arbiter

- **Status:** Accepted (pending owner review in the architecture PR)
- **Date:** 2026-11-03

## Context

The spec text has ambiguities, and the HL7 suite is the shared yardstick that implementations are measured against. Its inputs are mostly XML, and it changes upstream.

## Decision

Vendor a pinned copy of the suite and its fixtures. Convert XML inputs once with a model-driven converter. Run the suite in CI with a committed baseline that may only ratchet upwards. Publish the report in the repo.

## Consequences

Progress is visible and regressions are caught. Upstream updates are deliberate PRs. Disagreements between the suite and the spec are resolved case by case and recorded in `spec-notes.md`.
