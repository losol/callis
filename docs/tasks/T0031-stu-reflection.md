# T0031 — STU: reflection and instance selector

Part of the [roadmap](../roadmap.md). Phase 2 · wave 8 · size M.

- **Depends on:** [T0038](T0038-public-api-completion.md)

## Goal

`type()` returning `SimpleTypeInfo`, `ClassInfo` or `ListTypeInfo` ([N1 §10.2](https://hl7.org/fhirpath/N1/#reflection), simplified in 3.0.0), and the 3.0.0 instance-selector syntax (`Type { element: value, … }`) using the model to build instances.

## Acceptance criteria

Conformance group `testType` passes in R4 and R5; the instance selector parses, is type-checked with a model, and evaluates. `type()` and the instance selector take their types from the provider, and their model cases pass against the real `r4`, `r5` and `r6` providers, including the R6-only `DeviceAlert` ([FHIR versions](../roadmap.md#fhir-versions)), with no R6 conformance claim.
