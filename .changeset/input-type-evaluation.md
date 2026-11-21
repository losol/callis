---
'@callis/core': minor
---

Evaluation uses the `inputType` option too, so it agrees with analysis. With one type name and a model, an input that does not say its type is evaluated as a value of that type: an object without its own `resourceType`, such as a `Period` on its own, and a JSON string, number or boolean for a primitive type. With `r4` and `inputType: 'Period'`, `start > @2019` on `{ start: '2020-01-01' }` is `[true]`, `start is FHIR.dateTime` is `[true]`, and the `_start` extensions are found. Each item of an array input is typed the same way. An input that names its own type keeps it, even when `inputType` names another, and the conflict is not reported. With several type names the input stays untyped, as before. Variables and the `resource` and `rootResource` options are not typed by it, and `resolve()` still recognizes a resource by its own `resourceType`.
