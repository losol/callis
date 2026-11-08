# T0016 — Functions: math

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size S.

- **Depends on:** [T0008](T0008-compiler-evaluator.md)
- **Area:** `area:functions`
- **Parallel with:** [T0010](T0010-operators.md)–[T0015](T0015-fn-string.md), [T0017](T0017-fn-tree-utility.md), [T0018](T0018-model-aware-evaluation.md)

## Goal

[N1 §5.7](https://hl7.org/fhirpath/N1/#math) (STU in N1, but in phase-1 scope): `abs`, `ceiling`, `exp`, `floor`, `ln`, `log`, `power`, `round`, `sqrt`, `truncate`, using the T0004 kernels. `abs` also supports Quantity.

## Acceptance criteria

- [ ] The spec examples are tests. Invalid results (`(-1).sqrt()`, `(-1).power(0.5)`) are empty.
- [ ] Conformance groups: `testRound`, `testSqrt`, `testAbs`, `testCeiling`, `testExp`, `testFloor`, `testLn`, `testLog`, `testPower`, `testTruncate`.
