# T0024a — Static analysis: type inference and diagnostics

Part of the [roadmap](../roadmap.md). Phase 1 · wave 5 · size L.

- **Depends on:** [T0018](T0018-model-aware-evaluation.md), [T0019](T0019-fhir-model-generator.md)
- **Area:** `area:core`
- **Tier hint:** `risk:high`: a public `analyze()` and diagnostics on `compile()`, so the core tier with a second reviewer from the other vendor.
- **Parallel with:** [T0020](T0020-fhir-functions.md), [T0021](T0021-hooks-async.md)
- **Parent:** [T0024](T0024-static-analysis.md), split on 2026-11-12; [T0024b](T0024b-strict-mode.md) adds strict mode on top of this task.

## Goal

Levels 1 and 2 of the [T0024 design notes](T0024-static-analysis.md#design-notes): type and cardinality inference over the AST, the diagnostics that `compile()` throws and `analyze()` returns, and the fraction warning.

## Scope

- `src/analysis/`: `inferred-type.ts` (the type sets and cardinality of a value), `operators.ts` (the operator rules at the type level, mirroring the runtime kernels), `scope.ts` (the focus and the type guards in force) and `analyzer.ts` (the walk, which never changes the AST and never evaluates).
- Always, in `compile()`: an unknown function, a wrong number of arguments, a type argument that is not a type name, `$total` outside `aggregate()` (`semantic/undefined-variable`), and an input or argument of a type a function never accepts (`semantic/type-mismatch`), from the expectations the functions declare (`input`, `expects` and `scope` in `functions/define.ts`). An operator whose operands it never accepts is a warning, because the suite expects the execution error ([spec notes](../spec-notes.md#function-types-are-checked-statically-operator-types-when-evaluated)).
- With a model: `semantic/unknown-element` (with a `hint` for a choice element written with its type suffix), a leading type name that does not match the input (`semantic/type-mismatch`), and `semantic/unknown-type` warnings that keep the [T0008 error timing](T0008-compiler-evaluator.md#type-names-that-do-not-resolve). The type guards of the suite's `isSemanticChecks` group ([spec notes](../spec-notes.md#type-guards)).
- The `semantic/fraction-ignored` warning, as the parent describes it ([spec notes](../spec-notes.md#fractions-in-datetime-arithmetic)).
- Internal API: `analyze()`, the `inputType` option (one type name or several, needs `model`), and `compile()` throwing `FhirPathSemanticError` with every diagnostic attached. `Diagnostic` gets an optional `hint`.
- Public API: `analyze()` and `AnalysisResult`, model-less, designed for the `model` and `inputType` options that [T0038](T0038-public-api-completion.md) adds. `strict` is [T0024b](T0024b-strict-mode.md).
- The conformance runner's adapter analyzes every test with the type of its input, as the HL7 Java runner does ([spec notes](../spec-notes.md#static-analysis-of-every-test)).
- **FHIR versions:** as the parent says; the cases run against the real `r4`, `r5` and `r6` providers in `packages/core/test/generated-models.test.ts`.

## Acceptance criteria

- [x] `name.given1` and `Encounter.name.given` on `inputType: 'Patient'` are semantic errors (tests `testSimpleFail`, `testSimpleWithWrongContext`), and so is `Observation.valueQuantity.unit` (`testPolymorphismB`, with the hint `value.ofType(Quantity)`) and `(Observation.value as Period).unit` (`testPolymorphismAsB`).
- [x] Conformance group `isSemanticChecks` passes, as do all `invalid="semantic"` tests in phase 1 that do not need strict mode, in R4 and R5. `testIif6` and `testDollarOrderNotAllowed` are [T0024b](T0024b-strict-mode.md).
- [x] With the real `r4`, `r5` and `r6` providers, the same expression gets each version's diagnostics: `Observation.triggeredBy` is `semantic/unknown-element` under R4 only, `Observation.instantiates` under R4 and R6, and `inputType: 'DeviceAlert'` is valid under R6 only. No R6 conformance result is claimed.
- [x] Analysis without a model never produces false errors for valid expressions in the suite (`tools/conformance/src/static-analysis.test.ts`).
- [x] Unknown-type warnings leave compilation successful and produce execution errors only at evaluated use sites; model-less unqualified resource-name targets produce no unknown-type diagnostic. Known nonmatching types are not unknown-type errors.
- [x] `analyze()` reports a warning for each ignored fraction written in the expression: `@1973-12-25 + 7.7 days` (`testPlusDate2`), `@T10:00 + 1.5 hours`, `@2014 + 23 months` and `today() - 7.7 days`. It reports none for `@1973-12-25 + 7 days`, for `@1973-12-25T00:00:00.000+10:00 + 0.1 's'` (`testPlusDate19`, which keeps the fraction) or for a quantity from the input data. The warned expressions compile and evaluate to the same results as before.
