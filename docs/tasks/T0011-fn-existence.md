# T0011 — Functions: exists and count

Part of the [roadmap](../roadmap.md). Phase 1 · wave 5 · size S.

- **Depends on:** [T0008](T0008-compiler-evaluator.md), [T0009](T0009-equality-kernels.md), [T0012](T0012-fn-filtering.md)
- **Issue:** [#23](https://github.com/losol/callis/issues/23)
- **Background:** [T0025](T0025-public-api-release.md), [T0041](T0041-fn-existence-completion.md)

## Goal

[N1 §5.1](https://hl7.org/fhirpath/N1/#existence): `exists([criteria])`, `count` on the existing model-less evaluator and synchronous public API.

## Scope

- Reuse T0012's shared predicate helper for optional criteria. Preserve its exact canonical Boolean/singleton contract, empty handling, focus/variable and nested `$this`/`$index` behaviour; do not invent another conversion policy.
- Existence without criteria reports whether input has an item. With criteria, return whether a matching item exists; short-circuit once a match is established without evaluating later items. Empty input returns false. Count returns the input collection size, including zero for empty input.
- Preserve internal sync/async helper compatibility without exposing async publicly. Register only these two new functions; preserve existing options/signatures and input immutability.
- Add public examples combining where with exists/count, relevant documentation/playground examples and a minor changeset.

T0012 is a real dependency because it owns the shared predicate helper. Implement this as a separate task PR, stacked after the where PR when authorized. The original remaining existence functions and their equality/conformance acceptance are preserved in [T0041](T0041-fn-existence-completion.md). This narrowed task does not include them or model-aware evaluation/new API options.

## Acceptance criteria

- [ ] Spec examples for both functions are tests in `existence.test.ts`, including zero/one/many input items and false/empty/non-Boolean/multi-item criteria under the canonical predicate contract.
- [ ] Criteria reuse the where helper and preserve nested frames/variables in internal sync/async tests; a successful existence match avoids later predicate evaluation.
- [ ] Public compile/evaluate on synthetic JSON support the two functions and composed where/exists/count expressions, with plain output and no API-option expansion.
- [ ] On the combined where/exists/count head, conformance groups `testExists`, `testCount` and the inherited `testWhere` pass; the baseline may only increase. The pinned where fixtures require this task's count implementation, so do not claim their full group passed on the where-only parent. Remaining existence-group criteria stay in T0041.
- [ ] Documentation/examples, minor changeset and relevant package/browser checks cover only the approved three-function 0.2 surface.
