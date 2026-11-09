---
'@callis/core': minor
---

Add `empty()`, `all(criteria)`, `allTrue()`, `anyTrue()`, `allFalse()`, `anyFalse()`, `subsetOf(other)`, `supersetOf(other)`, `distinct()` and `isDistinct()`, completing the existence functions with `exists()` and `count()`. `all()` stops at the first item whose criterion does not match, as `exists()` stops at a match. `allTrue()` and the other three take only Booleans; any other item raises `eval/type-mismatch`. `subsetOf()` and `supersetOf()` use `=`, and an item whose equality is undetermined is not a member. `distinct()` keeps the last of equal items, in input order, and returns the input items themselves. When two values cannot be compared, such as `@2020` and `@2020-01-01`, `distinct()` and `isDistinct()` give empty, as the HL7 tests expect. An element that holds only extensions, such as one with only a data-absent-reason, is never equal to another item, so `distinct()` keeps it and it does not make either result empty.
