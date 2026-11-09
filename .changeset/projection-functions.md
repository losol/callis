---
'@callis/core': minor
---

Add `select(projection)`, `repeat(projection)` and `ofType(type)`. `select()` evaluates the projection for each item, with `$this` and `$index`, and flattens the results. `repeat()` applies the projection to the input and then to every new item, until no new item comes: an item is new unless it equals (`=`) one already found, and the result lists the new items breadth first. One `repeat()` call produces at most 5,000 items; a projection that keeps making new values, such as `'x'.repeat($this & 'x')`, raises `eval/limit-exceeded`. `ofType()` keeps the items of a type, with the same type resolution as `is` and `as`: without a model, a resource name keeps the objects whose own `resourceType` is that name, and a type that does not resolve, such as `FHIR.Patient` without a model, raises `eval/unknown-type`, also on empty input.
