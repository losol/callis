# T0019 — FHIR model generator and model packages

Part of the [roadmap](../roadmap.md). Phase 1 · wave 2 · size L.

- **Depends on:** [T0003](T0003-types-and-collections.md)
- **Parallel with:** [T0002](T0002-parser.md), [T0006](T0006-quantity.md) (and later waves)
- **Background:** [ADR-0008](../adr/0008-model-provider.md)

## Goal

Generate compact R4 and R5 models from the official StructureDefinitions and publish them as `ModelProvider`s ([design notes](#design-notes), [ADR-0008](../adr/0008-model-provider.md)).

## Scope

- `tools/model-gen`:
  - downloads [`hl7.fhir.r4.core@4.0.1`](https://packages.fhir.org/hl7.fhir.r4.core/4.0.1) and [`hl7.fhir.r5.core@5.0.0`](https://packages.fhir.org/hl7.fhir.r5.core/5.0.0) from the FHIR package registry into a local cache that is not committed
  - reads the snapshots
  - emits a deterministic, compact TypeScript data module
- What the data module contains: types, base types, kinds, abstractness; elements with name, types, whether they repeat and whether they are choices; backbone types named by path; `contentReference` resolved; the primitive → System mapping.
- `packages/fhir-r4` (`@callis/fhir-r4`) and `packages/fhir-r5` (`@callis/fhir-r5`): `ModelProvider` implementations over the generated data, exported as `r4` and `r5`, with a peer dependency on `@callis/core`.
- A CI job (on changes to `tools/model-gen` or a manual trigger) that checks regeneration gives no diff.

## Design notes

- A generator in `tools/model-gen` reads `StructureDefinition` snapshots from the official FHIR NPM packages ([`hl7.fhir.r4.core@4.0.1`](https://packages.fhir.org/hl7.fhir.r4.core/4.0.1), [`hl7.fhir.r5.core@5.0.0`](https://packages.fhir.org/hl7.fhir.r5.core/5.0.0)) at development time.
- For each version it emits a compact TypeScript module with:
  - types, base types, kinds and abstractness
  - elements: name, types, whether they repeat, whether they are choices
  - backbone element types named by path (`Patient.contact`)
  - resolved `contentReference`s (`Questionnaire.item.item` → `Questionnaire.item`)
  - the primitive → System type mapping
- These are published as **`@callis/fhir-r4`** and **`@callis/fhir-r5`**, each exporting a ready-made `ModelProvider`. R4B can be added cheaply later.
- The generated output is **committed**, so diffs are reviewable and builds need no network. A CI job checks that regenerating gives no diff.
- **Size budget:** at most 60 kB gzip per model, to be measured.
- Richer metadata for `elementDefinition()`, `slice()`, `checkModifiers()` and `conformsTo()` (phase 2) goes in a separate entry point, so the default model stays small.

## Acceptance criteria

- [ ] All resources and data types from the core packages are present. Spot checks:
  - `Patient.deceased` is a choice of `boolean | dateTime`
  - `Questionnaire.item.item` resolves to `Questionnaire.item`
  - `Bundle.entry.resource` has type `Resource`
  - `Observation.value[x]` lists the correct types per version
- [ ] Both providers pass the `ModelProvider` contract suite from T0003 (`describeModelProviderContract` in `packages/core/test/support/model-provider-contract.ts`), starting from a broad set of resources and data types, with fixtures for the primitive → System mapping (including `date` → `Date`, derived primitives and `Quantity`/`Age`) and for choice elements such as `Observation.value` and `Patient.deceased`.
- [ ] Running the generator twice gives byte-identical output.
- [ ] Gzip size per model is reported. Over 60 kB needs a justification in the PR.
