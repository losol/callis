# T15 — Functions: string manipulation

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size M.

- **Depends on:** [T8](T08-compiler-evaluator.md)
- **Parallel with:** [T10](T10-operators.md)–[T14](T14-fn-conversion.md), [T16](T16-fn-math.md)–[T18](T18-model-aware-evaluation.md)

## Goal

[N1 §5.6](https://hl7.org/fhirpath/N1/#string-manipulation): `indexOf`, `substring`, `startsWith`, `endsWith`, `contains`, `upper`, `lower`, `replace`, `matches`, `replaceMatches`, `length`, `toChars`.

## Scope

- Decide whether "characters" means Unicode code points or UTF-16 units. The 3.0.0 examples count a surrogate pair as one character; record the choice in `spec-notes.md`.
- Regular expressions use JavaScript `RegExp` with the `u` flag. Record dialect notes.

## Acceptance criteria

- [ ] The spec examples are tests, including empty and edge cases (`substring` out of range, `''.length()`).
- [ ] Conformance groups: `testCase`, `testToChars`, `testIndexOf`, `testSubstring`, `testStartsWith`, `testEndsWith`, `testContainsString`, `testMatches`, `testReplaceMatches`, `testReplace`, `testLength` (except STU cases with regex flags).
