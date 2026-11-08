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

- [x] The spec examples are tests, including empty and edge cases (`substring` out of range, `''.length()`).
- [x] Conformance groups: `testCase`, `testToChars`, `testIndexOf`, `testSubstring`, `testStartsWith`, `testEndsWith`, `testContainsString`, `testMatches`, `testReplaceMatches`, `testReplace`, `testLength` (except STU cases with regex flags). Every test that does not pass yet calls `empty()` ([T0041](T0041-fn-existence-completion.md)), `select()` ([T0042](T0042-fn-projection-completion.md)) or `toString()` ([T0014](T0014-fn-conversion.md)), or is `matchesFull()` ([T0029](T0029-stu-strings.md)); the generated reports list them as "not implemented".

## Implementation notes

- `functions/string.ts` defines the twelve functions. The input and each argument go through singleton evaluation as a String (an `Integer` for `substring()`), whether or not another one is empty, so an error does not depend on the data. `functions/characters.ts` holds the code point arithmetic and `functions/regex.ts` the regular expressions; both are internal.
- The decisions are in [spec notes](../spec-notes.md#characters-are-unicode-scalar-values): characters are Unicode scalar values, regular expressions are JavaScript's with the `u` and `s` flags, the substitution of `replaceMatches()` takes `${name}` and JavaScript's patterns, and an empty regex changes nothing.
- No new error code: an invalid pattern, or a substitution that refers to a missing group, is `eval/invalid-argument`. Messages do not repeat the pattern, which can come from input data.
- [T0029](T0029-stu-strings.md) adds the optional `flags` parameter to `matches()` and `replaceMatches()`: `compileRegex()` already takes the flags, and an optional parameter does not change the calls written today.
