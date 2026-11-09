---
'@callis/core': minor
---

Add `last()`, `tail()`, `skip(num)`, `take(num)`, `intersect(other)`, `exclude(other)`, `union(other)` and `combine(other)`, completing the subsetting and combining functions with `first()` and `single()`. They return the input items themselves, in a fixed order: the input first, then the new items of `other`. `intersect()` and `union()` list equal items once, `exclude()` keeps duplicates, and `combine()` keeps every item. `union()` is the `|` operator. An item whose equality is undetermined, such as a date of another precision, is not equal. An empty `num` gives empty from `skip()` and `take()`; a `num` that is not a single Integer raises `eval/singleton-expected` or `eval/type-mismatch`.
