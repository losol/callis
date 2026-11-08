# T0015 — Functions: string manipulation

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size M.

- **Depends on:** [T0008](T0008-compiler-evaluator.md)
- **Area:** `area:functions`
- **Parallel with:** [T0010](T0010-operators.md)–[T0014](T0014-fn-conversion.md), [T0016](T0016-fn-math.md)–[T0018](T0018-model-aware-evaluation.md)

## Goal

[N1 §5.6](https://hl7.org/fhirpath/N1/#string-manipulation): `indexOf`, `substring`, `startsWith`, `endsWith`, `contains`, `upper`, `lower`, `replace`, `matches`, `replaceMatches`, `length`, `toChars`.

## Scope

- Decide whether "characters" means Unicode code points or UTF-16 units. The 3.0.0 examples count a surrogate pair as one character; record the choice in `spec-notes.md`.
- Regular expressions use JavaScript `RegExp` with the `u` flag. Record dialect notes.

## Acceptance criteria

- [ ] The spec examples are tests, including empty and edge cases (`substring` out of range, `''.length()`).
- [ ] Conformance groups: `testCase`, `testToChars`, `testIndexOf`, `testSubstring`, `testStartsWith`, `testEndsWith`, `testContainsString`, `testMatches`, `testReplaceMatches`, `testReplace`, `testLength` (except STU cases with regex flags).
