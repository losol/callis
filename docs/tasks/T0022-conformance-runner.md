# T0022 — Conformance runner

Part of the [roadmap](../roadmap.md). Phase 1 · wave 1 · size M.

- **Depends on:** [T0000](T0000-scaffold.md)
- **Parallel with:** [T0001](T0001-lexer.md), [T0003](T0003-types-and-collections.md), [T0004](T0004-decimal.md), [T0005](T0005-date-time.md)
- **Background:** [ADR-0011](../adr/0011-conformance-suite.md)

## Goal

Run the official HL7 FHIRPath test suite and report the results ([design notes](#design-notes), [ADR-0011](../adr/0011-conformance-suite.md)).

## Scope

- `tools/conformance` (private):
  - vendored `tests-fhir-r5.xml` (from `r5/fhirpath/`) and `tests-fhir-r4.xml` (from `r4/fhirpath/`), plus every input file they reference, from [FHIR/fhir-test-cases](https://github.com/FHIR/fhir-test-cases) at a pinned commit
  - `SOURCE.md` with the commit SHA and the Apache-2.0 notice
  - an `update-fixtures` script
- A test-file parser (a dev-only XML parser such as `fast-xml-parser` is fine).
- Typed comparison of expected outputs (`boolean`, `integer`, `decimal`, `string`, `date`, `dateTime`, `time`, `code`, `id`, `Quantity`).
- Support for `invalid`, `predicate`, `ordered`, `context`/`contextType`, `mode` and `version`.
- Classification of each test as *phase 1*, *STU* or *unsupported*.
- An **injectable evaluator**: the runner calls a small adapter interface ([adapter interface](#adapter-interface)) rather than importing `@callis/core` directly. A stub adapter in the runner is used until an engine exists. It answers "not implemented", so every test is reported as failing or skipped, not crashed.
  - T0008 wires the adapter to the engine's internal `compile()`/`evaluate()`.
  - T0025 switches it to the public API.
- A runner CLI and a Vitest project (`pnpm test:conformance`).
- Reports: Markdown to `docs/conformance/{r4,r5}.md` (generated, never committed), a JSON summary (a CI artifact), and a CI job summary. The CI job is non-blocking until T0023.
- A baseline ratchet (`tools/conformance/baseline/{r4,r5}.txt`) and a CI check against it.

## Design notes

- **Source:** the HL7 suite in [FHIR/fhir-test-cases](https://github.com/FHIR/fhir-test-cases) (Apache-2.0). That is `r5/fhirpath/tests-fhir-r5.xml` (the source of truth, about 1,350 tests), the R4 copy `r4/fhirpath/tests-fhir-r4.xml` (about 1,190 tests), and the input files they reference from `r4/` and `r5/`.
- **Fixtures** are vendored into `tools/conformance/fixtures/{r4,r5}/` at a pinned commit, with a `SOURCE.md` recording the commit SHA and license, and an `update-fixtures` script.
- **Input conversion:** most inputs are FHIR XML (`patient-example.xml` is used by roughly 1,000 tests). A model-driven XML → JSON converter (dev only; it uses the generated models and keeps decimal text) converts them once, and the JSON is committed.
- **Test semantics:**
  - `invalid="syntax"` expects `FhirPathSyntaxError`, and `invalid="execution"` expects `FhirPathEvaluationError`. `invalid="semantic"` expects `FhirPathSemanticError`; an evaluation error also counts, but the report marks it "detected late", because [N1 §11](https://hl7.org/fhirpath/N1/#type-safety-and-strict-evaluation) leaves compile-time versus run-time checking to the implementation. `invalid="true"` accepts any error.
  - Labels the suite gets wrong for our scope are listed in `spec-notes.md` as exceptions. For example, the out-of-scope `documentFunctions` group marks arity errors as `syntax`.
  - `<output type="…">` values are compared using typed output; a test with no outputs expects an empty result.
  - `predicate="true"` converts the result to a Boolean.
  - `context` and `contextType` evaluate against a sub-node.
  - `mode` (`strict`, `lenient/polymorphics`, `element`, `html`, `tx`, `cda`) maps to options or marks the test unsupported.
  - `version` marks tests that need a newer FHIRPath version.
- **Classification:** each test is tagged *phase 1*, *STU* or *unsupported* from its group, its `testing` attribute and its `version`. The report shows pass/fail/skip per group and per phase.
- **Outputs:** the reports `docs/conformance/r4.md` and `r5.md`, a JSON summary uploaded with the CI results artifact, and a CI job summary. The reports are generated, never committed: `pnpm conformance`, the CI job and the site build write them, and the site publishes them at `/conformance/r4` and `/conformance/r5`. The first version of the runner committed them, and every PR that changed evaluation behaviour then conflicted on them ([#187](https://github.com/losol/callis/pull/187), 2026-11-09; [ADR-0011](../adr/0011-conformance-suite.md) has the amendment).
- **Ratchet:** `tools/conformance/baseline/r4.txt` and `r5.txt` list the passing tests, one test ID per line, sorted (the first version was one `baseline.json`). CI fails if a test that used to pass now fails. A PR that makes more tests pass updates the baseline.
- It also runs as a Vitest project (`pnpm test:conformance`) to get per-test diffs.

### Adapter interface

Defined in `tools/conformance/src/adapter.ts` and documented in [`tools/conformance/README.md`](../../tools/conformance/README.md#plugging-in-an-evaluator). `tools/conformance/src/engine-adapter.ts` chooses the adapter; it is the only file T0008 and T0025 change to plug in the engine.

```ts
interface EvaluatorAdapter {
  readonly name: string;
  parseInput?(text: string): unknown;   // default JSON.parse; T0018's lossless parser goes here
  evaluate(input: unknown, expression: string, options: EvaluationOptions): readonly unknown[] | PromiseLike<readonly unknown[]>;
  describeValue(value: unknown): ResultItem;       // { type: 'System.Decimal', value: '1.50' }, …
  classifyError(error: unknown): ClassifiedError;  // syntax | semantic | execution | not-implemented | other
}
```

`EvaluationOptions` carries what the test asks for: the FHIR version, `context` and `contextType`, the raw `mode`, and `strict`, `lenientChoiceSuffix` and `skipStaticCheck` derived from it. `describeValue` keeps the typed comparison independent of the engine's value classes.

### Decisions made while building the runner

- **Converted inputs:** an XML input `name.xml` is read from `name.json` in the same fixture folder. T0023 writes those files; until then the tests are skipped as "fixture not converted".
- **Classification** is per test, not per group: a test that calls an STU function is STU even in a phase-1 group (for example `testPeriodInvariantNew` in `period`, and the `type()` tests in `testType`).
- **Comparison** follows the HL7 Java test runner (exact types, decimals with their precision, type-only checks for empty outputs); the details and the few differences are in [spec notes](../spec-notes.md#comparing-expected-outputs).
- **The ratchet** also fails CI when the baseline is out of date: tests that pass but are not in it yet, or tests that must leave it (`pnpm conformance --check`). While the reports were committed, an out-of-date report only warned, so parallel PRs did not serialize on the report files (owner decision in #65); now that they are generated, a report cannot be out of date. A baseline test that becomes an exception or unsupported is not a regression: `--update-baseline` drops it, as it drops tests that left the suite.
- **Exceptions** are listed in `tools/conformance/src/exceptions.ts`, each with its `spec-notes.md` entry, and are skipped.
- **Report stability:** the reports show failure kinds and error codes, not engine messages or file paths, so a report changes only when an outcome changes, not when an error message is reworded.

## Acceptance criteria

- [x] The runner runs end to end with its runner-local stub adapter. T0000's public API is still empty, so it does not depend on it. Every test is either run or skipped with a reason; nothing crashes the runner.
- [x] The adapter interface is documented, so T0008 and T0025 can plug in the engine without changing the runner.
- [x] Tests with JSON inputs run. Tests with XML inputs are skipped with the reason "fixture not converted" until T0023.
- [x] The report shows pass/fail/skip per group and per phase, with links to the failing expressions.
