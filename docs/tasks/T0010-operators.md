# T0010 — Operators

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size L.

- **Depends on:** [T0008](T0008-compiler-evaluator.md), [T0009](T0009-equality-kernels.md)
- **Parallel with:** [T0011](T0011-fn-existence.md)–[T0018](T0018-model-aware-evaluation.md)

## Goal

All remaining N1 operators, with correct empty propagation, singleton rules and errors ([N1 §6](https://hl7.org/fhirpath/N1/#operations)).

## Scope

- `=`, `~`, `!=` and `!~` (on top of T0009).
- `<`, `>`, `<=` and `>=`.
- `+` for numbers, strings, quantities and date/time; `-`, `*`, `/`, `div` and `mod`; `&`.
- `|` (union with deduplication), `in` and `contains`.
- Integer overflow behaviour and division by zero (empty).
- Date/time + quantity arithmetic, wired to T0005/T0006.
- Singleton checks with `eval/singleton-expected`.

## Acceptance criteria

- [ ] Every example in N1 §6.1–6.7 has a table-driven test.
- [ ] Empty propagation is tested for every operator, including `&` (empty = `''`) and `{} ~ {}` (`true`).
- [ ] Conformance groups: `testEquality`, `testNEquality`, `testEquivalent`, `testNotEquivalent`, `testLessThan`, `testLessOrEqual`, `testGreatorOrEqual`, `testGreaterThan`, `testIn`, `testContainsCollection`, `testBooleanLogicAnd`, `testBooleanLogicOr`, `testBooleanLogicXOr`, `testBooleanImplies`, `testPlus`, `testConcatenate`, `testMinus`, `testMultiply`, `testDivide`, `testDiv`, `testMod`, `testPrecedence`, `testQuantity` and `testIndexer`. Any failures that remain are explained in the PR.
