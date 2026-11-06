# T0037 — First 0.1 release readiness

Part of the [roadmap](../roadmap.md). Phase 1 · wave 7 · size M.

- **Depends on:** [T0025](T0025-public-api-release.md), [T0036](T0036-playground.md)
- **Background:** [RELEASING.md](../../RELEASING.md), [T0038](T0038-public-api-completion.md), [release-readiness issue #82](https://github.com/losol/callis/issues/82)

## Goal

Prepare a useful first stable 0.1 release of the implemented subset, with a small public API and a simple playground. Full phase-1 implementation is a later milestone, not a first-release gate. Publication and npm/repository settings remain owner actions.

## Scope

- A version-specific support and limitations section in the README and user guide: supported runtimes, model-less JSON, implemented operators/functions, exact-output options, stable errors, missing model-aware behaviour, analysis, hooks and async APIs. Link the playground and committed R4/R5 conformance reports and their source revision.
- Per-phase conformance counts and exceptions, measured with the actual engine and public subset, without claiming general FHIRPath compliance. Never lower the baseline or excuse unimplemented work as a spec interpretation. Distinguish passing, failing, unsupported and excepted cases.
- Executable guide/README examples, one source shared with the documentation site, and installation/import/evaluation smoke tests of packed tarballs in fresh Node and Vite projects. Smoke tests must not publish anything.
- Review the existing release workflow and prerelease state; do not recreate them. Produce an explicit owner-reviewed package/version/publish-plan inventory. Pending changesets, peer ranges and the workflow may include all four packages: do not assume a core-only release or silently publish unready companions. Every included package must have its supported contract, license, package checks, examples and install tests documented. Generated models may be published as provider data without claiming model-aware evaluation is implemented. If a package cannot meet that bar, report the blocker for an owner decision on staging; no release until the inventory is safe.
- Reconcile #82 against current evidence, retaining unresolved owner actions. Confirm the UCUM license gate for any included `@callis/ucum` package. Do not change npm, secrets, environments or repository settings.
- Record a generated API-reference decision; handwritten public API documentation is sufficient for this small first surface. Later reference coverage stays with T0038.

## Release sequence and support

0.1 ships only the documented subset. Subsequent 0.x releases incrementally add function groups, model-aware evaluation, FHIR functions, hooks/async and analysis as their tasks merge; each release updates support, limitations, examples and per-phase conformance. T0038 completes the phase-1 API and documentation in a later 0.x release. This sequence sets no promised version number for a capability and does not define 1.0 scope or criteria; those remain an explicit owner decision.

Existing API compatibility rules still apply before 1.0: design for extension and justify unavoidable breaking minor releases with alternatives and a changeset. Do not add a major changeset for routine 0.x work.

## Acceptance criteria

- [x] The support/limitations matrix, public examples and playground describe the same implemented surface and engine revision.
- [x] Per-phase R4/R5 conformance and exceptions are documented; baseline never regresses. Full phase-1 pass rate is not required for 0.1.
- [x] Packed packages pass fresh Node/Vite import, type and evaluation smoke tests; all included packages pass publint, attw, dependency, size and license checks.
- [x] The owner has a concrete package/version inventory and release blockers, including any unsafe workflow inclusion, unresolved #82 actions or prerelease transitions. No unsupported package is implicitly approved.
- [x] The owner-run release path reuses the existing provenance workflow and runbook. This task ends with reviewable release preparation, not an npm publish or a merge of the version PR.
- [x] Later 0.x completion is linked to T0038; 1.0 scope and criteria remain open.

## Implementation notes

The [0.1 release inventory](../releases/0.1.0.md) records all four contracts/versions/peers, artifact checks, support limits, conformance and a dated read-only settings audit. `pnpm check:release` tests actual tarballs in fresh Node/TypeScript and Vite/Chromium consumers; `--stable` simulates version generation in a disposable copy. The task ends at reviewable preparation, while owner-only npm/settings and exact regenerated version-PR approval remain explicit release gates.
