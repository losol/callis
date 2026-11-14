# @callis/fhir-r5

An immutable, synchronous FHIR R5 (5.0.0) `ModelProvider` for Callis.

```ts
import { r5 } from '@callis/fhir-r5';

const patient = r5.getType('Patient');
if (patient) {
  const deceased = r5.getElement(patient, 'deceased');
  // typeNames: ['boolean', 'dateTime']; isChoice: true
}
```

Exports only `r5`, typed as `ModelProvider` from the peer package `@callis/core`. No runtime dependencies or network access. Pass it to the engine as the `model` option, for type-directed navigation and analysis:

```ts
import { evaluate } from '@callis/core';
import { r5 } from '@callis/fhir-r5';

evaluate({ resourceType: 'Patient', deceasedBoolean: false }, 'Patient.deceased', { model: r5 }); // [false]
```

See [FHIR models](https://github.com/losol/callis/blob/main/docs/guide.md#fhir-models) in the guide.

Types include every core resource and datatype, abstract bases and path-named backbones such as `Questionnaire.item`. Elements include inherited fields in snapshot order. Choices use the FHIRPath name (`value`, without `[x]` or a JSON type suffix); `contentReference` resolves to the target backbone. Primitives omit implicit `value`. `date` maps to System `Date`; Quantity and its specializations map to System `Quantity` at the type level (individual values still need a UCUM code for conversion). Returned data is frozen and shared.

The default entry point contains navigation metadata only. Validation, terminology, slicing and other phase-2 metadata are reserved for a separate future entry point.

See [SOURCE.md](SOURCE.md) for pinned source and license records and [model-gen](../../tools/model-gen/README.md) for regeneration.
