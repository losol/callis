# T16 — Functions: math

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size S.

- **Depends on:** [T8](T08-compiler-evaluator.md)
- **Parallel with:** [T10](T10-operators.md)–[T15](T15-fn-string.md), [T17](T17-fn-tree-utility.md), [T18](T18-model-aware-evaluation.md)

## Goal

[N1 §5.7](https://hl7.org/fhirpath/N1/#math) (STU in N1, but in phase-1 scope): `abs`, `ceiling`, `exp`, `floor`, `ln`, `log`, `power`, `round`, `sqrt`, `truncate`, using the T4 kernels. `abs` also supports Quantity.

## Acceptance criteria

- [ ] The spec examples are tests. Invalid results (`(-1).sqrt()`, `(-1).power(0.5)`) are empty.
- [ ] Conformance groups: `testRound`, `testSqrt`, `testAbs`, `testCeiling`, `testExp`, `testFloor`, `testLn`, `testLog`, `testPower`, `testTruncate`.
