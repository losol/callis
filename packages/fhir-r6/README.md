# @callis/fhir-r6

An immutable, synchronous navigation `ModelProvider` derived from the HL7® FHIR® R6 **September 2026 draft snapshot**, `6.0.0-snapshot1`. This source is a prerelease snapshot, not final R6; future R6 revisions can change its types and fields.

```ts
import { r6 } from '@callis/fhir-r6';

const alert = r6.getType('DeviceAlert');
if (alert) {
  const signal = r6.getElement(alert, 'signal');
  // typeNames: ['DeviceAlert.signal']; isArray: true
}
```

Exports only `r6`, typed as the existing `ModelProvider` from peer package `@callis/core`. The provider reports `version: '6.0.0-snapshot1'`. There are no runtime dependencies or network requests. Pass it to the engine as the `model` option, like the R4 and R5 providers:

```ts
import { evaluate } from '@callis/core';
import { r6 } from '@callis/fhir-r6';

evaluate({ resourceType: 'DeviceAlert', label: 'SpO2 low' }, 'label', { model: r6, inputType: 'DeviceAlert' }); // ['SpO2 low']
```

The engine's tests run model-aware evaluation against this provider (T0018). This package makes no R6 FHIRPath conformance claim; there is no official R6 test suite. Known gaps: the R6 draft moved `%factory`, `%server` and `%terminologies` to an HL7 incubator guide, which Callis waits for, and its new `weight()` function waits for final R6. See [FHIR models](https://github.com/losol/callis/blob/main/docs/guide.md#fhir-models) in the guide and [FHIR versions](https://github.com/losol/callis/blob/main/docs/roadmap.md#fhir-versions) in the roadmap.

The pinned core snapshots supply 196 roots (124 resource, 51 complex and 21 primitive types), including abstract bases, and 487 path-named backbones. [inventory.json](inventory.json) records every generated type by kind. Core constraint profiles and logical models are excluded. The package includes R6-specific types such as `DeviceAlert`, `DosageDetails` and `RelativeTime`; it does not reuse R5 data.

Elements include inherited fields in snapshot order, with snapshot cardinalities and allowed types. Choices use their FHIRPath names (`value`, without `[x]` or a JSON type suffix). Local `contentReference`s resolve to target backbones, including recursive `Questionnaire.item.item`. Primitives omit implicit `value`; metadata for their `id` and `extension` remains available. `date` maps to System `Date`, `integer64` to `Long`, and Quantity specializations to `Quantity` at the type level. Value conversion and primitive extension navigation belong to the evaluator. Returned metadata is frozen and shared.

The default entry point contains navigation metadata only. FHIR validation, terminology, slicing and other richer metadata are outside this package's scope.

See [SOURCE.md](SOURCE.md) for the exact source, checksum, upstream metadata caveats and license records, and [model-gen](../../tools/model-gen/README.md) for regeneration. The Callis package version is independent of the FHIR source version. Source package metadata and a changeset do not authorize a release; release ordering and inventory are decided separately before merge.
