# T0044 — Functions: first and single

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size S.

- **Depends on:** [T0008](T0008-compiler-evaluator.md), [T0009](T0009-equality-kernels.md)
- **Issue:** [#141](https://github.com/losol/callis/issues/141)
- **Parent completion:** [T0013](T0013-fn-subsetting-combining.md) / [#25](https://github.com/losol/callis/issues/25)
- **Background:** [T0011](T0011-fn-existence.md), [T0012](T0012-fn-filtering.md)

## Goal

Implement only `first` and `single` from [N1 §5.3](https://hl7.org/fhirpath/N1/#subsetting) on the existing synchronous model-less public API.

## Scope

- Both functions take zero arguments. Use the existing registration, arity, collection and error contracts; no API-option or model support expansion.
- first returns empty for empty input; otherwise it retains the first item in input order. single returns empty for empty input, the same item for one item, and raises `eval/singleton-expected` for more than one item ([single](https://hl7.org/fhirpath/N1/#single--collection), [first](https://hl7.org/fhirpath/N1/#first--collection)).
- Preserve the selected item's value, ModelNode provenance and nested navigation, without mutating input or inventing coercions. Retain the evaluator's internal sync/async compatibility without exposing public async evaluation.
- Add scoped public documentation, synthetic playground examples and a minor changeset. The implementation owns conformance function-to-task mapping for first/single; remaining subsetting/combining functions stay assigned to T0013.
- This is a native GitHub sub-issue, not full T0013 delivery. Use `Task: T0044` and `Closes #141`; do not close #25 or mark all subsetting/combining implemented. No release version, milestone or date is selected.

## Acceptance criteria

- [ ] Spec-linked tests cover empty/one/many inputs, ordering, wrong arity and stable singleton error; selected values retain provenance and navigate correctly.
- [ ] Public compile/evaluate and composed where/first/single/count expressions work on synthetic JSON. Internal sync/async paths agree; existing where/exists/count contracts remain unchanged.
- [ ] Relevant pinned R4/R5 single and first cases pass, including `testCount3`/`testCount4`. Require first-only cases from `testFirstLast`, not the last-dependent half. Do not pull last or other pending functions into this child, edit fixtures, create missing-function exceptions or lower the baseline.
- [ ] Full checks, scoped browser/public consumer coverage and conformance pass; baseline may only increase. Current main starts at R4 phase 1 435 and R5 phase 1 486.
- [ ] Documentation/examples and minor changeset describe only delivered functionality. Parent #25 remains open with its eight remaining functions and full original acceptance preserved.
