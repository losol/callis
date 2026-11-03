# T23 — FHIR XML fixture conversion

Part of the [roadmap](../roadmap.md). Phase 1 · wave 3 · size M.

- **Depends on:** [T19](T19-fhir-model-generator.md), [T22](T22-conformance-runner.md)
- **Parallel with:** [T7](T07-ucum.md), [T8](T08-compiler-evaluator.md), [T9](T09-equality-kernels.md)
- **Background:** [ADR-0011](../adr/0011-conformance-suite.md)

## Goal

Convert the suite's XML input files to FHIR JSON once, so that every test can run.

## Scope

- A model-driven FHIR XML → JSON converter in `tools/conformance`, using `@callis/fhir-r4` and `@callis/fhir-r5`:
  - arrays according to cardinality
  - typed primitives, with decimals kept as lossless text
  - `id`/`extension` on primitives written as `_field`
  - `xhtml` → string
  - `resourceType`, contained resources and choice element names
- The converted JSON is committed next to the XML.
- A check against an official JSON example where one exists (for example `patient-example` from `hl7.fhir.r4.examples`), allowing only documented differences.
- The conformance CI job becomes blocking, with the baseline ratchet.

## Acceptance criteria

- [ ] Every XML input referenced by the suite converts. Any input that is out of scope (such as `ccda.xml`) is listed.
- [ ] The comparison with official JSON examples shows no unexplained differences.
- [ ] After this task, the conformance report covers every phase-1 test, and the baseline is committed.
