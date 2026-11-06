# T0040 — R6 package and compatibility validation

Part of the [roadmap](../roadmap.md). Phase 1 · wave 6 · size M.

- **Depends on:** [T0039](T0039-fhir-r6-model.md), [T0025](T0025-public-api-release.md)
- **Issue:** [#123](https://github.com/losol/callis/issues/123)
- **Background:** [T0018](T0018-model-aware-evaluation.md), [T0037](T0037-first-release-readiness.md), [T0038](T0038-public-api-completion.md), [RELEASING.md](../../RELEASING.md)

## Goal

Verify the actual R6 provider as an installed package and integrate it into shared quality gates without changing the currently reviewed release inventory or claiming new evaluator support.

## Scope

- Shared runtime-dependency and size checks, public-package scope validation, workspace lockfile importer, package/consumer checks and CI regeneration coverage. Keep root/workflow edits narrowly scoped; do not duplicate T0039 package-local source/license/contracts work.
- Extend regeneration CI to check R6 and prove R4/R5 nonregression. Real source identity/version/checksum/license must match [T0039's pin](T0039-fhir-r6-model.md#pinned-source-and-maturity).
- Pack the real R6 package, verify ESM/export maps/declarations/README/full license/source notices, and install alongside the actual core tarball in fresh strict-peer Node/TypeScript and Vite/browser consumers. No workspace aliases or placeholder provider data. Verify exact R6 source version, immutability, source-grounded metadata differences and shared core identity while retaining R4/R5/UCUM checks.
- Measure the built R6 model's gzip size with an initial 60 KiB budget consistent with existing model packages; report/justify a different ceiling before changing it. Require zero runtime dependencies.
- Demonstrate the **installed pinned Changesets** version-generation and publish-discovery behaviour in isolated temporary directories only, using a non-network stub or dry-run mechanism that cannot call a real publish. Record the intended `0.0.0` plus minor changeset and `^0.1.0-0` peer, the local placeholder `0.0.1` collision implications, which packages/versions would be discovered before/after version generation, and concrete ordering options for the owner. Do not infer npm state from local fixtures or print credentials.
- Preserve the current four-package first-0.1 release fixture/inventory unless an explicit reviewed delivery decision changes it. Add independent R6 verification without quietly treating it as approved for #93. Do not introduce `private: true`, ignored changesets, conditional release hacks or arbitrary version changes to stage it.
- Record exact-head checks and release-discovery evidence in the maintained validation/readiness comment. Scope/support docs must distinguish actual R6 provider metadata from model-aware engine support (T0018), eventual public model options (T0038), validation and any R6 conformance suite. Existing R4/R5 reports are not R6 evidence; do not invent an R6 pass count.

## Delivery and release dependency

Implementation, verification and draft review proceed now. Before merging a publishable R6 workspace package or its integration into main, the owner must choose a concrete release ordering: include R6 through a deliberately regenerated and reviewed version/package inventory, or keep R6 branches unmerged until the current four-package release completes. This is a pre-merge dependency, not a repeated approval gate during development, and does not decide permanent inclusion or exclusion.

The existing release workflow can discover every unpublished workspace package. A new source package, pending minor changeset or local `0.0.1` placeholder is not proof of npm availability, version safety or release authorization. Keep the actual first-0.1 inventory at four packages until the reviewed decision changes it. Do not edit version PR #93, publish/deprecate packages, configure trusted publishers/settings, remove changesets, mark the intended package private, or add conditional release exclusions to bypass that decision. [T0040](T0040-fhir-r6-validation.md) provides isolated release-discovery evidence and ordering options for it.

## Acceptance criteria

- [ ] Shared checks discover and verify the real R6 package; source pin/notices, zero runtime dependencies, size budget, exports and installed Node/types/Vite consumers pass.
- [ ] Deterministic R6 regeneration is covered in CI; R4/R5 generated output and all existing consumers/tests remain green. No test or conformance baseline is weakened.
- [ ] Isolated Changesets evidence gives concrete package/version discovery and placeholder-collision implications without any real publish, settings change or #93 mutation.
- [ ] A concrete pre-merge owner decision is requested with release ordering options, while implementation and draft review complete independently of that decision.
- [ ] `pnpm check` and relevant packed/browser/regeneration checks pass on the exact candidate; support language makes no model-aware/public-R6/conformance claim and the four-package inventory is unchanged absent a reviewed decision.
