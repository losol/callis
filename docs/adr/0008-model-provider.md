# ADR-0008: ModelProvider with generated FHIR models in separate packages

- **Status:** Accepted (owner review, 2026-11-03)
- **Date:** 2026-11-03

## Context

The core must work without a model, while FHIR use needs choice types, primitive types, inheritance and semantic checks for several FHIR versions.

## Decision

A small synchronous `ModelProvider` interface in the core. `@callis/fhir-r4` and `@callis/fhir-r5` are generated from the official StructureDefinitions by `tools/model-gen`, and the generated output is committed. The owner confirmed these package names, and that the `@callis` npm scope is secured (2026-11-03).

## Consequences

Users pay the model's bundle size only when they use it. New FHIR versions (R4B, R6) mostly need a generator run. The generator becomes a maintained tool, with CI checking that its output is reproducible.
