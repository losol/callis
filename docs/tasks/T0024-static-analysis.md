# T0024 — Static analysis and strict mode

Part of the [roadmap](../roadmap.md). Phase 1 · wave 5 · size L.

- **Depends on:** [T0018](T0018-model-aware-evaluation.md), [T0019](T0019-fhir-model-generator.md)
- **Parallel with:** [T0020](T0020-fhir-functions.md), [T0021](T0021-hooks-async.md)

## Goal

Semantic checks and type inference with a model ([design notes](#design-notes)).

## Scope

- `src/analysis/`: type and cardinality inference over the AST, using the model, the function return types (`returns` in `FunctionDefinition`) and the operator rules.
- Diagnostics:
  - `semantic/unknown-element`
  - `semantic/unknown-type`
  - a wrong root type
  - choice suffixes, with a hint
  - obvious operator type errors
- Strict mode ([N1 §11](https://hl7.org/fhirpath/N1/#type-safety-and-strict-evaluation)) for operations that are unsafe on singletons.
- A public `analyze()`. `compile()` throws `FhirPathSemanticError` with all diagnostics attached.

## Design notes

Analysis runs at three levels:

1. **Always, as part of `compile()`.** Is the function known? Is its arity right? Are lambda and type-specifier arguments where they should be? Is `$total` used outside `aggregate()`? Failures throw `FhirPathSemanticError`. Invalid literal *values* are deliberately not on this list ([T0008: invalid literal values](T0008-compiler-evaluator.md#invalid-literal-values)).
2. **Model-aware**, opt-in with `model` + `inputType`. Type inference over the AST: every node gets a set of possible types and a cardinality (`0..1` or `0..*`). This catches:
   - unknown elements (`name.given1`)
   - choice elements used with a type suffix (`Observation.valueQuantity`), with the hint "use `value.ofType(Quantity)`"
   - a root type that does not match the input (`Encounter.name` on a Patient)
   - unknown types in `is`/`as`/`ofType`
   - obvious operator type errors (`1 + 'a'`)
3. **Strict mode** (`strict: true`, [N1 §11](https://hl7.org/fhirpath/N1/#type-safety-and-strict-evaluation)). Warnings become errors for the unsafe uses listed in N1 §11. The main example is a singleton-only operator or function given an operand that may repeat, such as `Patient.name.given < 'X'` or `Patient.name.given.substring(1)`. Equality is only flagged in the narrower case §11 describes: one operand may repeat and the other is a single item (`Patient.name.given = 'Wouter'`). Comparing two collections, as in `Patient.name = Patient.name`, is well-defined ([T0009: equality and equivalence](T0009-equality-kernels.md#equality-and-equivalence)) and stays valid. The basic version comes in phase 1; the full version later.

The result is a list of `Diagnostic { severity: 'error' | 'warning'; code; message; span }`. `compile()` throws on errors; `analyze()` returns the diagnostics without throwing, for tooling. The test suite's `invalid="semantic"` cases and `mode="strict"` tests are covered by levels 2 and 3.

## Acceptance criteria

- [ ] `name.given1` and `Encounter.name.given` on `inputType: 'Patient'` are semantic errors (tests `testSimpleFail`, `testSimpleWithWrongContext`), and so is `Observation.valueQuantity.unit` (`testPolymorphismB`).
- [ ] Conformance group `isSemanticChecks` passes, as do all `invalid="semantic"` tests in phase 1.
- [ ] Analysis without a model never produces false errors for valid expressions in the suite.
