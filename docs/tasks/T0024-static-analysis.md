# T0024 — Static analysis and strict mode

Part of the [roadmap](../roadmap.md). Phase 1 · wave 5 · size L.

- **Depends on:** [T0018](T0018-model-aware-evaluation.md), [T0019](T0019-fhir-model-generator.md)
- **Area:** `area:core`
- **Tier hint:** likely `risk:high`: a public `analyze()` and diagnostics on `compile()`, so the core tier with a second reviewer from the other vendor.
- **Parallel with:** [T0020](T0020-fhir-functions.md), [T0021](T0021-hooks-async.md)

## Goal

Semantic checks and type inference with a model ([design notes](#design-notes)).

## Split

The implementation grew far beyond a few hundred hand-written lines, so it was split on 2026-11-12 along the three levels of the [design notes](#design-notes), as [CONTRIBUTING](../CONTRIBUTING.md#pull-requests) asks ([#35](https://github.com/losol/callis/issues/35)):

- [T0024a](T0024a-static-analysis-diagnostics.md): levels 1 and 2, the type inference, the diagnostics of `compile()`, the public `analyze()`, the fraction warning and the conformance runner's static check of every test.
- [T0024b](T0024b-strict-mode.md): level 3, strict mode, including the order-dependent operations of [#72](https://github.com/losol/callis/issues/72), and the public `strict` option.

This file keeps the scope, the design notes and the acceptance criteria they share; each child lists the criteria it delivers. The task is complete, and [#35](https://github.com/losol/callis/issues/35) closes, when both have merged.

## Scope

- `src/analysis/`: type and cardinality inference over the AST, using the model, the function return types (`returns` in `FunctionDefinition`) and the operator rules.
- Diagnostics:
  - `semantic/unknown-element`
  - `semantic/unknown-type`
  - a wrong root type
  - choice suffixes, with a hint
  - obvious operator type errors
  - a warning when date/time arithmetic ignores a fraction written in the expression ([3.0.0 Date/Time Arithmetic](https://hl7.org/fhirpath/STU3/#datetime-arithmetic): "Implementers SHOULD produce a warning when decimal fractions are ignored"; [spec notes](../spec-notes.md#fractions-in-datetime-arithmetic)). The owner decided this on 2026-11-11 ([#52](https://github.com/losol/callis/issues/52)):
    - It applies when the right operand of `+` or `-` is a quantity literal and the analyzer knows that the left operand is a Date, DateTime or Time, which it does for a literal or a function such as `today()`, and for an element only with a model. When the analyzer cannot tell, it reports nothing.
    - `isFractionIgnored()` in `values/datetime/arithmetic.ts` decides. It gets the value's precision when the value is a literal too (`@2014 + 23 months`), and no precision otherwise (`today() + 7.7 days`), so it then checks only the quantity.
    - The diagnostic is a warning, also in strict mode: the expression compiles and evaluates as before, and the fraction is ignored as the spec note describes.
    - A quantity computed during evaluation gets no warning. A runtime warning would need a host hook in `EvaluationHooks` ([T0021](T0021-hooks-async.md#host-hooks)), which is not planned for now; `isFractionIgnored()` stays internal so that a later hook can use it.
- Strict mode ([N1 §11](https://hl7.org/fhirpath/N1/#type-safety-and-strict-evaluation)) for operations that are unsafe on singletons.
- A public `analyze()`. `compile()` throws `FhirPathSemanticError` with all diagnostics attached.
- **FHIR versions** ([roadmap](../roadmap.md#fhir-versions)): what is a known element, type or choice type comes from the provider, so the analyzer has no version-specific code. The model-aware analysis cases also run against the real `r4`, `r5` and `r6` providers, with the differences of the pinned sources: `Observation.triggeredBy` is an element in R5 and R6 and unknown in R4; `Observation.instantiates` is an element in R5 only (the R6 draft removed it); `DeviceAlert` is an `inputType` and root type in R6 only; `Observation.value` allows `Reference` in R5 only and `Attachment` in R5 and R6. R6 results are engine tests on the pinned draft, not conformance.

## Design notes

Analysis runs at three levels:

1. **Always, as part of `compile()`.** Is the function known? Is its arity right? Are lambda and type-specifier arguments where they should be? Is `$total` used outside `aggregate()`? Failures throw `FhirPathSemanticError`. Invalid literal *values* are deliberately not on this list ([T0008: invalid literal values](T0008-compiler-evaluator.md#invalid-literal-values)).
2. **Model-aware**, opt-in with `model` + `inputType`. Type inference over the AST: every node gets a set of possible types and a cardinality (`0..1` or `0..*`). This catches:
   - unknown elements (`name.given1`)
   - choice elements used with a type suffix (`Observation.valueQuantity`), with the hint "use `value.ofType(Quantity)`"
   - a root type that does not match the input (`Encounter.name` on a Patient)
   - unknown types in `is`/`as`/`ofType`, as `semantic/unknown-type` warnings: [T0008](T0008-compiler-evaluator.md#type-names-that-do-not-resolve) resolves targets at compile time but raises `eval/unknown-type` only when evaluated, as the phase-1 execution-error fixtures require. These warnings do not become compile errors in strict mode. Without a model, an unqualified resource-name target is valid, not an unknown type ([#58](https://github.com/losol/callis/issues/58), [#59](https://github.com/losol/callis/issues/59))
   - obvious operator type errors (`1 + 'a'`)
3. **Strict mode** (`strict: true`, [N1 §11](https://hl7.org/fhirpath/N1/#type-safety-and-strict-evaluation)). Warnings become errors for the unsafe uses listed in N1 §11. The main example is a singleton-only operator or function given an operand that may repeat, such as `Patient.name.given < 'X'` or `Patient.name.given.substring(1)`. Equality is only flagged in the narrower case §11 describes: one operand may repeat and the other is a single item (`Patient.name.given = 'Wouter'`). Comparing two collections, as in `Patient.name = Patient.name`, is well-defined ([T0009: equality and equivalence](T0009-equality-kernels.md#equality-and-equivalence)) and stays valid. The basic version comes in phase 1; the full version later.

The result is a list of `Diagnostic { severity: 'error' | 'warning'; code; message; span }`. `compile()` throws on errors; `analyze()` returns the diagnostics without throwing, for tooling. The test suite's `invalid="semantic"` cases and `mode="strict"` tests are covered by levels 2 and 3.

## Acceptance criteria

- [ ] `name.given1` and `Encounter.name.given` on `inputType: 'Patient'` are semantic errors (tests `testSimpleFail`, `testSimpleWithWrongContext`), and so is `Observation.valueQuantity.unit` (`testPolymorphismB`).
- [ ] Conformance group `isSemanticChecks` passes, as do all `invalid="semantic"` tests in phase 1, in R4 and R5.
- [ ] With the real `r4`, `r5` and `r6` providers, the same expression gets each version's diagnostics: `Observation.triggeredBy` is `semantic/unknown-element` under R4 only, `Observation.instantiates` under R4 and R6, and `inputType: 'DeviceAlert'` is valid under R6 only. No R6 conformance result is claimed.
- [ ] Analysis without a model never produces false errors for valid expressions in the suite.
- [ ] Unknown-type warnings leave compilation successful and produce execution errors only at evaluated use sites, even in strict mode; model-less unqualified resource-name targets produce no unknown-type diagnostic. Known nonmatching types are not unknown-type errors.
- [ ] `analyze()` reports a warning for each ignored fraction written in the expression ([spec notes](../spec-notes.md#fractions-in-datetime-arithmetic)): `@1973-12-25 + 7.7 days` (`testPlusDate2`), `@T10:00 + 1.5 hours`, `@2014 + 23 months` and `today() - 7.7 days`. It reports none for `@1973-12-25 + 7 days`, for `@1973-12-25T00:00:00.000+10:00 + 0.1 's'` (`testPlusDate19`, which keeps the fraction) or for a quantity from the input data. In strict mode too, the warned expressions compile, and they evaluate to the same results as before.
