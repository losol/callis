# @callis/fhir-r4

An immutable, synchronous FHIR R4 (4.0.1) `ModelProvider` for Callis.

```ts
import { r4 } from '@callis/fhir-r4';

const patient = r4.getType('Patient');
if (patient) {
  const deceased = r4.getElement(patient, 'deceased');
  // typeNames: ['boolean', 'dateTime']; isChoice: true
}
```

Exports only `r4`, typed as `ModelProvider` from the peer package `@callis/core`. No runtime dependencies or network access. The engine evaluates with it through its internal `model` option, which the conformance runner uses (T0018); the public `model` option arrives with the expanded public API (T0038).

Types include every core resource and datatype, abstract bases and path-named backbones such as `Questionnaire.item`. Elements include inherited fields in snapshot order. Choices use the FHIRPath name (`value`, without `[x]` or a JSON type suffix); `contentReference` resolves to the target backbone. Primitives omit implicit `value`. `date` maps to System `Date`; Quantity and its specializations map to System `Quantity` at the type level (individual values still need a UCUM code for conversion). Returned data is frozen and shared.

The default entry point contains navigation metadata only. Validation, terminology, slicing and other phase-2 metadata are reserved for a separate future entry point.

See [SOURCE.md](SOURCE.md) for pinned source and license records and [model-gen](../../tools/model-gen/README.md) for regeneration.
