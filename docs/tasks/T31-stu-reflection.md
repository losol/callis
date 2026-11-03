# T31 — STU: reflection and instance selector

Part of the [roadmap](../roadmap.md). Phase 2 · wave 8 · size M.

- **Depends on:** [T25](T25-public-api-release.md)

## Goal

`type()` returning `SimpleTypeInfo`, `ClassInfo` or `ListTypeInfo` ([N1 §10.2](https://hl7.org/fhirpath/N1/#reflection), simplified in 3.0.0), and the 3.0.0 instance-selector syntax (`Type { element: value, … }`) using the model to build instances.

## Acceptance criteria

Conformance group `testType` passes; the instance selector parses, is type-checked with a model, and evaluates.
