---
"@callis/core": minor
---

Add `exists([criteria])` and `count()` to the synchronous model-less evaluator. Existence criteria reuse the established filtering predicate rules and stop at the first match. Empty collections return false for existence and zero for count; no public API options or async surface are added.
