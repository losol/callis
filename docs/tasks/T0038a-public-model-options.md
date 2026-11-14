# T0038a — Public API: model-aware options

Part of the [roadmap](../roadmap.md). Phase 1 · wave 7 · size M.

- **Depends on:** [T0018](T0018-model-aware-evaluation.md), [T0019](T0019-fhir-model-generator.md), [T0024b](T0024b-strict-mode.md), [T0025](T0025-public-api-release.md), [T0039](T0039-fhir-r6-model.md)
- **Area:** `area:core`
- **Tier hint:** `risk:high`: new public option types and exports, so the core tier with a second reviewer from the other vendor.
- **Parallel with:** [T0038b](T0038b-public-async-hooks-limits.md), [T0038c](T0038c-public-parser-cache.md), [T0038d](T0038d-public-typed-output.md)
- **Parent:** [T0038](T0038-public-api-completion.md), split on 2026-11-12.

## Goal

Model-aware evaluation and analysis through the public API: the `model`, `inputType` and `lenient` compile options of the [T0038 sketch](T0038-public-api-completion.md#public-api-sketch). `evaluate(patient, 'Patient.deceased', { model: r4 })` then navigates with the FHIR model ([T0018](T0018-model-aware-evaluation.md)), and `compile('name.given1', { model: r4, inputType: 'Patient' })` reports the unknown element when the expression is compiled ([T0024a](T0024a-static-analysis-diagnostics.md)).

## Scope

- `src/api/public-api.ts`: `CompileOptions` gains three options, which `analyze()`, `compile()` and `evaluate()` all take:
  - `model?: ModelProvider`: any provider, so `r4`, `r5` and `r6` need no version-specific API.
  - `inputType?: string | readonly string[]`: the type of the input, or the types it may have, for model-aware analysis; needs `model`.
  - `lenient?: LenientOptions`, with `choiceSuffix?: boolean` ([ADR-0012](../adr/0012-evaluation-defaults.md)).
- Option validation, each failure `eval/invalid-argument`:
  - `model`: an object with a `namespace` that is a non-empty string other than `System` ([#60](https://github.com/losol/callis/issues/60)), a string `version`, and the six methods of `ModelProvider`.
  - `inputType`: a string or an array of strings, and only with `model`.
  - `lenient`: an object whose only option is a boolean `choiceSuffix`. Any other key is rejected, so a future relaxation is never a silent no-op.
- `src/index.ts` exports the `LenientOptions` type.
- Tests through the public entry point with the real `r4`, `r5` and `r6` providers: typed navigation of a choice element and of a primitive with extensions, analysis with `inputType` including a case where the versions differ, `lenient.choiceSuffix`, strict mode with a model, and every validation error. Type tests for the new options.
- Packed consumers: `scripts/check-public-api.ts` and `scripts/check-release-packages.ts` evaluate with `r4`, `r5` and `r6` in the Node, TypeScript and Vite consumers. The type checks that said public model-aware evaluation did not exist are replaced by ones that it does.
- Documentation: a guide section on FHIR models (R4, R5, and R6 as the pinned draft with its known gaps and no conformance number), the core README, and the READMEs of `@callis/fhir-r4`, `@callis/fhir-r5` and `@callis/fhir-r6`. The guide's TypeScript examples run in CI, so the snippet check accepts imports from the model and unit packages. A `minor` changeset for `@callis/core`.

Not in scope: the evaluation options `hooks`, `signal`, `concurrency`, `now` and `limits` ([T0038b](T0038b-public-async-hooks-limits.md)), typed output ([T0038d](T0038d-public-typed-output.md)) and the `functions` option ([#222](https://github.com/losol/callis/issues/222)).

## Design notes

- The facade validates the options and passes them to the internal API (`api/compile.ts`), which implements them since T0018 and T0024. The internal API keeps working without the checks; the conformance runner uses it until [T0038e](T0038e-public-conformance-adapter.md).
- The model is not wrapped, unlike the unit system: `ModelProvider` is synchronous, pure and precomputed by contract, and its methods run on the navigation hot path. The facade checks its shape once per compilation.
- An `inputType` array is copied after it is checked, so analysis reads exactly the names that were checked. A type name that the model does not define is a `semantic/unknown-type` error from the analysis, not an invalid option.
- Data that the model has no type for, such as an object without a known `resourceType`, is still navigated by its JSON keys, as without a model ([T0018](T0018-model-aware-evaluation.md)).

## Acceptance criteria

From the [parent](T0038-public-api-completion.md#acceptance-criteria):

- [x] The public `model` option evaluates with `r4`, `r5` and `r6` in the type tests and in the packed Node and Vite consumers. The guide and READMEs label R6 as the pinned draft, list its known gaps and publish no R6 conformance number.
- [x] [#60](https://github.com/losol/callis/issues/60): a model whose namespace is `System` or empty is rejected with `eval/invalid-argument`. No future option is accepted as a silent no-op.
- [x] The guide examples for the model options are executed in CI.
- [x] publint, attw, the zero-dependency check and the size budget all pass.

And for this child:

- [x] Through the public API, `Observation.value.ofType(Quantity)` and a FHIR primitive with an extension evaluate as with the internal API, `Observation.triggeredBy` on `inputType: 'Observation'` is `semantic/unknown-element` under R4 only, and `Observation.valueQuantity` compiles only with `lenient: { choiceSuffix: true }`.
