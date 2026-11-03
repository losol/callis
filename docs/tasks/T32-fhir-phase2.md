# T32 — FHIR phase 2: structure functions and R5 service APIs

Part of the [roadmap](../roadmap.md). Phase 2 · wave 8 · size L.

- **Depends on:** [T25](T25-public-api-release.md)

## Goal

- `elementDefinition()`, `slice(structure, name)` and `checkModifiers(modifier)`. These need richer model metadata, delivered through a separate entry point of the model packages.
- The draft R5 APIs ([R5 §2.1.9.3–2.1.9.5](https://hl7.org/fhir/R5/fhirpath.html#txapi)), all hook-based:
  - `%terminologies` (`expand`, `lookup`, `validateVS`, `validateCS`, `subsumes`, `translate`) through an extended `TerminologyProvider`
  - `%server`
  - `%factory`

## Acceptance criteria

The `%terminologies` cases of `TerminologyTests` pass with a fake provider; the default model packages do not grow in size; the APIs are marked experimental in the docs.



---
