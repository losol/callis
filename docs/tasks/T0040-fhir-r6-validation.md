# T0040 — R6 package and compatibility validation

Part of the [roadmap](../roadmap.md). Phase 1 · wave 6 · size M.

- **Depends on:** [T0039](T0039-fhir-r6-model.md), [T0025](T0025-public-api-release.md)
- **Issue:** [#123](https://github.com/losol/callis/issues/123)
- **Background:** [T0018](T0018-model-aware-evaluation.md), [T0037](T0037-first-release-readiness.md), [T0038](T0038-public-api-completion.md), [RELEASING.md](../../RELEASING.md)

## Goal

Verify the actual R6 provider as an installed package and integrate it into shared quality gates for the owner-selected five-package first release, while preserving the distinction between that target and the currently generated version PR. No new evaluator support is claimed.

## Scope

- Shared runtime-dependency and size checks, public-package scope validation, workspace lockfile importer, package/consumer checks and CI regeneration coverage. Keep root/workflow edits narrowly scoped; do not duplicate T0039 package-local source/license/contracts work.
- Extend regeneration CI to check R6 and prove R4/R5 nonregression. Real source identity/version/checksum/license must match [T0039's pin](T0039-fhir-r6-model.md#pinned-source-and-maturity).
- Pack the real R6 package, verify ESM/export maps/declarations/README/full license/source notices, and install alongside the actual core tarball in fresh strict-peer Node/TypeScript and Vite/browser consumers. No workspace aliases or placeholder provider data. Verify exact R6 source version, immutability, source-grounded metadata differences and shared core identity while retaining R4/R5/UCUM checks.
- Measure the built R6 model's gzip size with an initial 60 KiB budget consistent with existing model packages; report/justify a different ceiling before changing it. Require zero runtime dependencies.
- Demonstrate the **installed pinned Changesets** version-generation and publish-discovery behaviour in isolated temporary directories only, using a non-network stub or dry-run mechanism that cannot call a real publish. Record the intended `0.0.0` plus minor changeset and `^0.1.0-0` peer, the local placeholder `0.0.1` collision implications, which packages/versions would be discovered before/after version generation, and the implications for the selected five-package first-release path. Do not infer npm state from local fixtures or print credentials.
- Extend the default `check:release` fixture and its stable simulation to all five intended packages, including R6, through the shared harness and CI. Keep one default five-package consumer path rather than duplicate R6 commands. Do not claim the current #93 already includes R6 or is covered by these implementation checks. Do not introduce `private: true`, ignored changesets, conditional release hacks or arbitrary version changes to stage it.
- Record exact-head checks and release-discovery evidence in the maintained validation/readiness comment. Scope/support docs must distinguish actual R6 provider metadata from model-aware engine support (T0018), eventual public model options (T0038), validation and any R6 conformance suite. Existing R4/R5 reports are not R6 evidence; do not invent an R6 pass count.

## Delivery and release dependency

The owner selected **R6 in the first stable 0.1 release** on 2026-11-06. The target inventory is five packages: core, UCUM, R4, R5 and R6, each at `0.1.0`, with the four companion core peers at `^0.1.0`. This replaces the earlier undecided inclusion/hold-back choice; it does not approve a merge or publication.

Deliver the R6 provider, shared five-package checks and reconciled release documentation through their reviewed PRs. After legitimate integration, let the existing workflow regenerate the version PR normally, retaining pending changesets. Inspect and test that **new immutable version-PR head**: exactly five intended versions, peers, stable changelogs, packed Node/TypeScript/Vite consumers, source/license/size/dependency checks, hosted CI and native approval. Earlier implementation or disposable-version evidence does not cover a future version-PR head. See the [selected inventory and owner gates](../releases/0.1.0.md).

The workflow can discover every unpublished workspace package. Intended source version `0.0.0` plus a normal minor changeset is not a staging barrier; a patch-only `0.0.1` would collide with a placeholder of the same version. A local placeholder proves no actual npm state. The owner must verify all five package identities, version availability, visibility, permissions, trusted publishers and provenance requirements before releasing. Do not edit #93 by hand, remove changesets, mark R6 private, add conditional exclusions, or change npm/settings to bypass those gates. Development and draft review continue without repeated release approval requests.

## Acceptance criteria

- [ ] Shared checks discover and verify the real R6 package; source pin/notices, zero runtime dependencies, size budget, exports and installed Node/types/Vite consumers pass.
- [ ] Deterministic R6 regeneration is covered in CI; R4/R5 generated output and all existing consumers/tests remain green. No test or conformance baseline is weakened.
- [ ] Isolated Changesets evidence gives concrete package/version discovery and placeholder-collision implications without any real publish, settings change or #93 mutation.
- [ ] The owner-selected five-package first-release inventory is represented in the default and stable checks; actual current version-PR state is distinguished from the planned candidate, with exact-head gates retained.
- [ ] `pnpm check` and relevant packed/browser/regeneration checks pass on the exact candidate; support language makes no claim of public model-aware R6 evaluation or R6 conformance and the selected five-package inventory is verified without implying current #93 regeneration, testing or publication.
