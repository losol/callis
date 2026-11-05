# T0023 — FHIR XML fixture conversion

Part of the [roadmap](../roadmap.md). Phase 1 · wave 3 · size M.

- **Depends on:** [T0019](T0019-fhir-model-generator.md), [T0022](T0022-conformance-runner.md)
- **Parallel with:** [T0007](T0007-ucum.md), [T0008](T0008-compiler-evaluator.md), [T0009](T0009-equality-kernels.md)
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
- The converted JSON is committed as `name.json` next to `name.xml` in the same fixture folder. The runner reads that exact path and skips the test as `fixture not converted` while it is missing ([T0022: converted inputs](T0022-conformance-runner.md#decisions-made-while-building-the-runner), `tools/conformance/src/fixtures.ts`, [#48](https://github.com/losol/callis/issues/48)).
- A check against an official JSON example where one exists (for example `patient-example` from `hl7.fhir.r4.examples`), allowing only documented differences.
- The conformance CI job becomes blocking, with the baseline ratchet.

## Acceptance criteria

- [ ] Every XML input referenced by the suite converts. Any input that is out of scope (such as `ccda.xml`) is listed.
- [ ] The comparison with official JSON examples shows no unexplained differences.
- [ ] After this task, the conformance report covers every phase-1 test, and the baseline is committed.
