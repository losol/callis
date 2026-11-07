---
'@callis/core': minor
---

Add lossless JSON input: `parseJson(text)` parses JSON while keeping every number as written, as a `JsonNumber`, so `1.50` keeps its precision through evaluation (`decimalOutput: 'string'` gives `'1.50'`). Invalid text raises `eval/invalid-json`. Evaluation also understands `JsonNumber` values in input from other sources.

The engine now evaluates with a `ModelProvider`: typed navigation of choice elements and FHIR primitives with their `_name` extensions, FHIR primitive values as System values (`date` as `Date`, `Quantity` with a UCUM code as `Quantity`), the root identifier as a type with inheritance, and `is`/`as` with model types. This is used by the conformance runner with the generated R4 and R5 models; the public `model` and `lenient` options follow with the expanded public API (T0038). Model-less evaluation is unchanged.
