# Conformance runner

Runs the official [HL7 FHIRPath test suite](https://github.com/FHIR/fhir-test-cases/tree/master/r5/fhirpath) against Callis and reports the results ([T0022](../../docs/tasks/T0022-conformance-runner.md), [ADR-0011](../../docs/adr/0011-conformance-suite.md)). This package is private and never published.

The reports are in [`docs/conformance/`](../../docs/conformance/): [R4](../../docs/conformance/r4.md) and [R5](../../docs/conformance/r5.md). CI also uploads a JSON summary and every test result as the `conformance-results` artifact.

## Commands

Run them from the repository root.

| Command | What it does |
| --- | --- |
| `pnpm conformance` | Run both suites, write the reports, and compare with the baseline. Fails if a test in the baseline no longer passes. |
| `pnpm conformance --update-baseline` | The same, and record the passing tests in `baseline.json`. Refuses if a baseline test regressed. |
| `pnpm conformance --check` | What CI runs. Writes no reports; fails on a regression or on a baseline that is out of date, and warns about reports that are out of date. `--results <file>` writes every test result as JSON, and `--summary <file>` the counts per suite, phase and group. |
| `pnpm test:conformance` | The suite as Vitest tests, one per suite test, with diffs for wrong results. Filter with `-t`, for example `pnpm test:conformance -t testLiterals`. Not part of `pnpm test`. |
| `pnpm --filter @callis/conformance update-fixtures --ref <commit>` | Vendor the suite at another upstream commit. Do it in its own PR. |

**When evaluation behaviour changes:** run `pnpm conformance --update-baseline` and commit `baseline.json` and `docs/conformance/`. The PR description shows the change in passing tests per phase.

## Layout

| Path | What |
| --- | --- |
| `fixtures/r4/`, `fixtures/r5/` | The vendored suite files and the input files they use, unchanged ([SOURCE.md](fixtures/SOURCE.md)). |
| `fixtures/source.json` | The pinned commit and the SHA-256 of every vendored file. A unit test checks them. |
| `baseline.json` | The tests that pass, per suite file. Generated. |
| `src/adapter.ts` | The evaluator adapter interface. |
| `src/engine-adapter.ts` | The adapter the commands use: the stub today. |
| `src/parse-suite.ts`, `src/suite.ts` | The test-file parser and model. |
| `src/classify.ts` | Phase 1, STU or unsupported. |
| `src/compare.ts` | Typed comparison of results with expected outputs. |
| `src/run-suite.ts` | Runs and judges tests. |
| `src/report.ts`, `src/summary.ts`, `src/baseline.ts`, `src/cli.ts` | Reports, counts, the ratchet and the command line. |
| `suite/` | The Vitest project behind `pnpm test:conformance`. |

## Plugging in an evaluator

The runner never imports `@callis/core`. It calls an `EvaluatorAdapter` ([`src/adapter.ts`](src/adapter.ts)), and [`src/engine-adapter.ts`](src/engine-adapter.ts) chooses which one. Until an engine exists that is the stub adapter, which throws "not implemented" for every evaluation, so every test that runs fails and nothing crashes. T0008 replaces it with an adapter over the engine's internal `compile()`/`evaluate()`, and T0025 switches to the public API; neither needs to change the runner.

```ts
interface EvaluatorAdapter {
  readonly name: string;                                   // shown in the reports
  parseInput?(text: string): unknown;                      // default JSON.parse; T0018 passes the lossless parser
  evaluate(input: unknown, expression: string, options: EvaluationOptions):
    readonly unknown[] | PromiseLike<readonly unknown[]>;  // the result collection, or throw
  describeValue(value: unknown): ResultItem;               // one result item, for comparison
  classifyError(error: unknown): ClassifiedError;          // what evaluate() threw
}
```

- **`evaluate`** gets the parsed input file (`undefined` when the test has none), the expression, and `EvaluationOptions` built from the test's attributes:

  | Option | From | Meaning |
  | --- | --- | --- |
  | `fhirVersion` | the suite file | `r4` or `r5`; selects the FHIR model. |
  | `context`, `contextTypes` | `context`, `contextType` | Evaluate `context` on the input first; it selects exactly one node, and the expression is evaluated with that node as its focus. `%resource` and `%rootResource` stay the whole input. `contextTypes` are the declared types of the focus for static analysis. |
  | `mode` | `mode` of the test, its expression or its group | The raw mode, for example `element` or `html`. |
  | `strict` | `mode="strict"` | [N1 §11](https://hl7.org/fhirpath/N1/#type-safety-and-strict-evaluation) strict evaluation. |
  | `lenientChoiceSuffix` | `mode="lenient"` or `lenient/polymorphics` | Accept `Observation.valueQuantity` ([ADR-0012](../../docs/adr/0012-evaluation-defaults.md)). |
  | `skipStaticCheck` | `skipStaticCheck` | Evaluate without static analysis. |

  It may return a promise. Inputs are parsed once per file and shared, so evaluation must not mutate them.
- **`describeValue`** turns one result item into `{ type, value?, unit? }`: the qualified type name (`System.Decimal`, `FHIR.code`, `FHIR.HumanName`), and for primitives and quantities the value as text with its precision (`1.50`, `2014-01-01`, `10:30:00.000`) and the unit (`cm`, `days`).
- **`classifyError`** maps the engine's errors to `syntax` (`FhirPathSyntaxError`), `semantic` (`FhirPathSemanticError`), `execution` (`FhirPathEvaluationError`), `not-implemented` or `other`, with the error code and message.

## How tests are run

Each test is classified first:

| Phase | Which tests | Run? |
| --- | --- | --- |
| Phase 1 | N1 normative content, Math and the FHIR additions ([ADR-0001](../../docs/adr/0001-spec-baseline.md)) | yes |
| STU | tests with `version` newer than 2.0.0, `mode="tx"`, a call to an STU function (`sort`, `aggregate`, `lowBoundary`, `type`, …) or STU syntax (`$total`, `1L`), and the STU-only groups. The report names the task (T0026–T0032) that implements them. | yes |
| Unsupported | the `cdaTests` and `documentFunctions` groups, `mode="cda"`, `mode="custom"` and unknown modes | skipped |

A test is skipped, with the reason, when it is unsupported, when it is an exception (below), or when its input is missing. XML inputs are read from the JSON converted from them (`name.json` next to `name.xml`), which T0023 adds; until then those tests are skipped as "fixture not converted".

A test that runs passes when:

- **`invalid="syntax"`** or **`"execution"`**: evaluation throws an error of that class.
- **`invalid="semantic"`**: evaluation throws a semantic error, or an evaluation error, which the report counts as "detected late" ([spec notes](../../docs/spec-notes.md#semantic-errors-found-during-evaluation)).
- **`invalid="true"`**: evaluation throws any FHIRPath error.
- **otherwise**: the result matches the outputs, item by item and in order (as a multiset when `ordered="false"`). No outputs means an empty result. With `predicate="true"` the result is first converted to a Boolean.

"Not implemented" and non-FHIRPath errors (`other`) never pass.

**Comparing values.** An output's `type` must be the result item's type: `System.Decimal` counts as `decimal`, `FHIR.code` as `code`, and types the suite does not name (`FHIR.uri`, `FHIR.HumanName`) never match. Values are compared exactly: decimals must have the same value and the same number of decimal places (`1.50` is not `1.5`), dates and times as text without `@`, and quantities by value and unit. An output with empty text checks only the type. R4 has outputs without a type; their text is a FHIRPath literal and is compared by kind. The rules follow the HL7 Java test runner; the details and differences are in [spec notes](../../docs/spec-notes.md#comparing-expected-outputs).

**Test IDs** are the test names, made unique per file with a `#2`, `#3` suffix (the R4 file has two `testEquivalent23`).

**Exceptions.** A test whose expectation is wrong for Callis is listed in [`src/exceptions.ts`](src/exceptions.ts) with a link to its entry in [`docs/spec-notes.md`](../../docs/spec-notes.md), and skipped.

**Reports** name each failing test with its expression and a one-line problem: the failure kind and the engine's error code, never the engine's message text or a file path. A report therefore only changes when an outcome changes. The full message is in `pnpm test:conformance` and in the CI results artifact.

## Baseline and CI

`baseline.json` lists every passing test. A baseline test that stops passing is a regression, which always fails. A baseline test can leave the baseline in only two ways: it is no longer in the suite (after a fixture update), or it is skipped on purpose because it became an exception or unsupported. `pnpm conformance --update-baseline` drops those tests and records new passes, and refuses to run when there is a regression.

CI runs `pnpm conformance --check`. It fails on a regression or on a baseline that is out of date (tests to drop or new passes to record): the PR that changes a test's outcome records it. Out-of-date reports are only a warning, so parallel PRs do not have to queue up behind each other's reports; the next `pnpm conformance` run refreshes them. The check adds a job summary, and the JSON summary and every test result are uploaded as an artifact. Locally, `pnpm conformance` fails only on a regression and lists the rest as hints. The decision is `ratchetFails()` in [`src/baseline.ts`](src/baseline.ts). The job is non-blocking until T0023 converts the XML inputs.
