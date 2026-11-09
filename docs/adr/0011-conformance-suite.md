# ADR-0011: HL7 test suite as the conformance arbiter

- **Status:** Accepted (owner review, 2026-11-03)
- **Date:** 2026-11-03

## Context

The spec text has ambiguities, and the HL7 suite is the shared yardstick that implementations are measured against. Its inputs are mostly XML, and it changes upstream.

## Decision

Vendor a pinned copy of the suite and its fixtures. Convert XML inputs once with a model-driven converter. Run the suite in CI with a committed baseline that may only ratchet upwards. Publish the report in the repo.

Amendment (2026-11-09, [#187](https://github.com/losol/callis/pull/187), [#188](https://github.com/losol/callis/issues/188)): the reports are no longer committed or kept in the repo. Every PR that changed evaluation behaviour regenerated them, and the parallel function PRs conflicted on them. `pnpm conformance`, the CI job and the site build generate them from the vendored suites and the engine of the commit: CI uploads them as the `conformance-results` artifact, and the documentation site publishes them at `/conformance/r4` and `/conformance/r5`. The baseline stays committed and reviewed, and may still only ratchet upwards. It is now one sorted test ID per line in `tools/conformance/baseline/r4.txt` and `r5.txt`, which merge without conflicts. The rest of the decision stands.

## Consequences

Progress is visible and regressions are caught. Upstream updates are deliberate PRs. Disagreements between the suite and the spec are resolved case by case and recorded in `spec-notes.md`.
