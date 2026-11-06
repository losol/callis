# T0039 — Pinned FHIR R6 model provider

Part of the [roadmap](../roadmap.md). Phase 1 · wave 3 · size M.

- **Depends on:** [T0019](T0019-fhir-model-generator.md)
- **Issue:** [#122](https://github.com/losol/callis/issues/122)
- **Background:** [ADR-0008](../adr/0008-model-provider.md), [T0018](T0018-model-aware-evaluation.md), [T0025](T0025-public-api-release.md), [T0040](T0040-fhir-r6-validation.md)

## Goal

Generate a real, separately versioned R6 navigation model from the exact published HL7 source below, using the existing provider architecture. R6 metadata delivery does not claim final R6 stability, FHIR validation or public model-aware FHIRPath evaluation.

## Scope

- Extend `tools/model-gen` with an explicit source URL, identity/license validation and checksum pin for R6. Fail closed on a mismatch; keep existing R4/R5 sources and generated output unchanged.
- Add `packages/fhir-r6` (`@callis/fhir-r6`) exporting immutable `r6: ModelProvider` with the exact FHIR source version. Generate both data and provider runtime from the shared generator; never copy R5 data or edit generated files manually.
- Preserve the current compact navigation contract: resource/complex/primitive types, inheritance, path-named backbones, cardinality, choice types, primitive-to-System mappings and recursive `contentReference` resolution. Do not add required core interface members or richer validation/terminology metadata.
- Package-local metadata, ESM/declarations/build/test setup, README, full MIT code license and CC0/HL7 source/trademark notices with the verified archive hash and metadata caveats. Use normal intended public-package metadata: source version `0.0.0`, peer `@callis/core: ^0.1.0-0`, and a minor changeset; these are not a release decision or npm state.
- Run the existing generated-provider contract over every generated root. Add source-grounded R6-versus-R5 tests, including R6-only `DeviceAlert`/`DosageDetails`, and changed `Observation.value[x]` types; assert actual pinned snapshots, not assumed final-R6 schemas. Preserve all supported source definitions or fail explicitly on unsupported shapes.
- Record the selected source definition/root inventory and deterministic generated inventory so missing or accidentally reused R5 definitions are detectable. Coordinate package-local ownership here with T0040's shared scripts/CI/lockfile ownership.

## Pinned source and maturity

As audited on 2026-11-06, [HL7's publication list](https://hl7.org/fhir/package-list.json) and [official package registry](https://packages2.fhir.org/packages/hl7.fhir.r6.core) list `6.0.0-snapshot1` after ballot5 and ballot4. Select **`hl7.fhir.r6.core@6.0.0-snapshot1`**, the September 2026 R6 draft snapshot, not a final R6 release.

- Archive: <https://hl7.org/fhir/6.0.0-snapshot1/hl7.fhir.r6.core.tgz>.
- Official registry mirror: <https://packages2.fhir.org/packages/hl7.fhir.r6.core/6.0.0-snapshot1>.
- SHA-256 of both independently downloaded archives: `c67aad1c83851aa7702f10a210f9e0e2c9fb0a54dcd43fd0826296dc6a175f59`.
- Manifest `name`, `version` and `fhirVersions` match the pin; `date` is `20260910165024`; source license is **CC0-1.0**.
- Versioned specification: <https://hl7.org/fhir/6.0.0-snapshot1/>; [license and trademark terms](https://hl7.org/fhir/6.0.0-snapshot1/license.html#license).

Upstream metadata is inconsistent: the manifest's `url` still names ballot5, its `homepage` is a local filesystem URL, and the publication list's snapshot date differs from the archive/registry September build date. Record these facts in source notices; do not relabel the data as ballot5 or silently fall back. The older `packages.fhir.org` R6 endpoint returned 404 during this audit; allow an explicit immutable download URL for R6 while preserving existing R4/R5 pins. Never consume floating `current`, `latest`, CI builds or `build.fhir.org` data. A future R6 revision requires a reviewed version/checksum/source update.

## Delivery and release dependency

Implementation, verification and draft review proceed now. Before merging a publishable R6 workspace package or its integration into main, the owner must choose a concrete release ordering: include R6 through a deliberately regenerated and reviewed version/package inventory, or keep R6 branches unmerged until the current four-package release completes. This is a pre-merge dependency, not a repeated approval gate during development, and does not decide permanent inclusion or exclusion.

The existing release workflow can discover every unpublished workspace package. A new source package, pending minor changeset or local `0.0.1` placeholder is not proof of npm availability, version safety or release authorization. Keep the actual first-0.1 inventory at four packages until the reviewed decision changes it. Do not edit version PR #93, publish/deprecate packages, configure trusted publishers/settings, remove changesets, mark the intended package private, or add conditional release exclusions to bypass that decision. [T0040](T0040-fhir-r6-validation.md) provides isolated release-discovery evidence and ordering options for it.

## Acceptance criteria

- [ ] The downloaded archive matches the exact SHA, package identity, FHIR version and CC0 license; no floating source or silent fallback is used.
- [ ] Generated `r6` reports `6.0.0-snapshot1` and passes the provider contract across all official supported roots, including primitives, choices, backbones and recursive references.
- [ ] Source inventory and version-specific tests prove real R6 data, including differences from R5; unsupported source shapes fail visibly.
- [ ] Generation twice is byte-identical; `--check` verifies both generated files; R4/R5 output and contracts remain unchanged.
- [ ] Package code/data notices, README maturity/support limits, declarations, minor changeset and package-local tests are complete; no runtime dependencies or required public interface changes.
- [ ] `pnpm check` passes, with shared integration coordinated through T0040. The pre-merge release decision remains explicit, without blocking draft delivery.
