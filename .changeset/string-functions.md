---
'@callis/core': minor
---

Add the string functions `indexOf()`, `substring()`, `startsWith()`, `endsWith()`, `contains()`, `upper()`, `lower()`, `replace()`, `matches()`, `replaceMatches()`, `length()` and `toChars()`. Characters are Unicode scalar values, as in FHIRPath 3.0.0: a surrogate pair is one character. `matches()` and `replaceMatches()` use JavaScript regular expressions with the `u` flag in single-line mode, and a pattern that is not valid raises `eval/invalid-argument`. A `replaceMatches()` substitution refers to groups as `${name}` or `${1}` (the specification's form) or in JavaScript's forms (`$1`, `$<name>`, `$&`, `$$`). Regular expression flags and `matchesFull()` come later.
