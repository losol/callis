---
'@callis/core': minor
---

Add the FHIR functions and variables. `extension(url)` filters extensions by URL; `hasValue()` is true for a single item with a primitive value and false otherwise, and `getValue()` gives that value; `resolve()` finds contained resources (`#id`) and the entries of a Bundle around a reference, by `fullUrl`, with a relative `Type/id` taken against the base of the entry it is in, and ignores anything else. `%resource` and `%rootResource` are the input by default, and the new evaluation options `resource` and `rootResource` set them; `%sct`, `%loinc`, `` %`vs-[name]` `` and `` %`ext-[name]` `` give their URLs. A `variables` entry of the same name still hides any of them, as before. `memberOf()`, `subsumes()`, `subsumedBy()`, `conformsTo()` and `htmlChecks()` now compile and return empty until host hooks arrive.

With a model (internal so far), `~` follows FHIR's equivalence rules: `id` elements are ignored, a `Coding` compares on `system` and `code`, and two `CodeableConcept`s are equivalent when they share an equivalent coding. A FHIR Quantity without a UCUM code now compares with, and orders against, another FHIR Quantity with the same unit, also when the other one has a UCUM code: the same `code` when both have one, and otherwise the same `unit` text.
