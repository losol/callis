# ADR-0008: ModelProvider with generated FHIR models in separate packages

- **Status:** Accepted (owner review, 2026-11-03)
- **Date:** 2026-11-03
- **Amended:** 2026-11-08, to record the R6 provider (owner decisions of 2026-11-06 in [T0039](../tasks/T0039-fhir-r6-model.md) and of 2026-11-08 in the [roadmap](../roadmap.md#fhir-versions))

## Context

The core must work without a model, while FHIR use needs choice types, primitive types, inheritance and semantic checks for several FHIR versions.

## Decision

A small synchronous `ModelProvider` interface in the core. `@callis/fhir-r4` and `@callis/fhir-r5` are generated from the official StructureDefinitions by `tools/model-gen`, and the generated output is committed. The owner confirmed these package names, and that the `@callis` npm scope is secured (2026-11-03).

Amendment (2026-11-08): the generator now also produces `@callis/fhir-r6`, from the pinned HL7 draft `hl7.fhir.r6.core@6.0.0-snapshot1` with an explicit source URL and checksum ([T0039](../tasks/T0039-fhir-r6-model.md#pinned-source-and-maturity)). R6 is best effort: the source is a draft, not final R6, and Callis makes no R6 conformance claim, because there is no official R6 FHIRPath suite. A newer snapshot or the final R6 is a reviewed provider update, not a silent regeneration.

## Consequences

Users pay the model's bundle size only when they use it. New FHIR versions (R4B, R6) mostly need a generator run. The generator becomes a maintained tool, with CI checking that its output is reproducible.
