# T0014 — Functions: conversion

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size M.

- **Depends on:** [T0008](T0008-compiler-evaluator.md)
- **Area:** `area:functions`
- **Parallel with:** [T0010](T0010-operators.md)–[T0013](T0013-fn-subsetting-combining.md), [T0015](T0015-fn-string.md)–[T0018](T0018-model-aware-evaluation.md)

## Goal

[N1 §5.5](https://hl7.org/fhirpath/N1/#conversion):

- `iif` (lazy: only the selected branch is evaluated)
- `toBoolean` and `convertsToBoolean`
- `toInteger` and `convertsToInteger`
- `toDecimal` and `convertsToDecimal`
- `toDate` and `convertsToDate`
- `toDateTime` and `convertsToDateTime`
- `toTime` and `convertsToTime`
- `toString` and `convertsToString`
- `toQuantity([unit])` and `convertsToQuantity([unit])`

## Scope

- With a model, the functions read the System value that [T0018](T0018-model-aware-evaluation.md) gives a typed FHIR primitive, the same for every provider ([FHIR versions](../roadmap.md#fhir-versions)). The R6 draft adds a FHIR note on `toString()` that limits it to FHIR primitives with a value ([§2.1.9.4.1](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#fn-toString)); check a typed FHIR `Quantity` against it and record any difference in `docs/spec-notes.md`.

## Acceptance criteria

- [ ] Each conversion table in N1 §5.5 is fully covered, including the string formats it accepts and rejects.
- [ ] `toString()` formats are tested: `1.0 → '1.0'`, `1 'wk'`, `1 week`, dates without `@`.
- [ ] Conformance groups: `testIif`, `testCollectionBoolean` (with T0010 for `|` and `/`), `testToInteger`, `testToDecimal`, `testToString`, and the conversion parts of `testLiterals` and `testTypes`.

## Implementation notes

- `functions/conversion.ts` defines every function of N1 §5.5 on the System value of the single input item ([T0018](T0018-model-aware-evaluation.md#modelnode)), with the string formats of N1 and the 3.0.0 clarifications. Unit tests are in `functions/conversion.test.ts`, the R4/R5/R6 cases in `packages/core/test/conversion-models.test.ts` and the UCUM `toQuantity(unit)` examples in `packages/ucum/test/conversion-integration.test.ts`.
- `iif()` needs the 3.0.0 scoping: the input is `$this` of its arguments, also when it is empty, and `$index` stays that of the enclosing function. The existing lambda helpers could not express that, so `LambdaArg` gains `forInput(input)` (`functions/define.ts`, `compiler/lambda.ts`, both `area:core`). The decisions are in [spec notes](../spec-notes.md#scope-of-the-iif-arguments).
- The R6 `toString()` note differs for a typed FHIR `Quantity`; Callis keeps one behaviour for every provider ([spec notes](../spec-notes.md#tostring-of-a-fhir-quantity)).
- Long values (`System.Long`, from `integer64`) are not converted yet; [T0028](T0028-stu-long.md) adds them ([#182](https://github.com/losol/callis/issues/182)). The optional `format` argument of `toDate()` and `toDateTime()` in 3.0.0 is not part of this task ([#183](https://github.com/losol/callis/issues/183)).
- Conformance-group residuals are due to other tasks: `empty()` and `distinct()` ([T0041](T0041-fn-existence-completion.md)), `select()` ([T0042](T0042-fn-projection-completion.md)), `today()` and `now()` ([T0017](T0017-fn-tree-utility.md)), and the strict-mode semantic error of `testIif6` ([T0024](T0024-static-analysis.md)). Exact case names are in the generated reports.
