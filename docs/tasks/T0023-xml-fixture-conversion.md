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

## Decisions made while building

- **XML reader:** the converter reads XML with its own strict reader (`tools/conformance/src/xml-reader.ts`), not `fast-xml-parser`, which does not normalize whitespace in attribute values ([XML 1.0 §3.3.3](https://www.w3.org/TR/xml/#AVNormalize)) and leaves undefined entities in the text. DTDs are refused.
- **Numbers** keep their XML text in the committed JSON (`1.50`, `9.5e2`). The runner parses inputs with `JSON.parse`, which loses it, until T0018 sets the adapter's `parseInput` to the lossless `parseJson` ([tools/conformance: converted inputs](../../tools/conformance/README.md#converted-xml-inputs)).
- **Interpretations** (narrative XHTML copied as written, attribute whitespace, `integer64`) are in [spec notes](../spec-notes.md#converting-the-xml-inputs).
- **Official examples:** the ten inputs that copy a FHIR example are compared with the official JSON from `hl7.fhir.r4.examples` 4.0.1 and `hl7.fhir.r5.examples` 5.0.0, vendored in `tools/conformance/official-examples/`. `tools/conformance/src/official-examples.ts` lists every difference with its reason.
- **Out of scope:** `r5/ccda.xml`, a CDA document used only by the unsupported `cdaTests` group (`UNCONVERTED_INPUTS` in `tools/conformance/src/fixture-conversion.ts`).
- **Baseline:** it records the tests that pass with the adapter in `engine-adapter.ts`. With the stub adapter that is none: every phase-1 test runs and fails as "not implemented", or is skipped as a documented exception.

## Acceptance criteria

- [x] Every XML input referenced by the suite converts. Any input that is out of scope (such as `ccda.xml`) is listed.
- [x] The comparison with official JSON examples shows no unexplained differences.
- [x] After this task, the conformance report covers every phase-1 test, and the baseline is committed.
