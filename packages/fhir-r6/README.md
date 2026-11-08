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

Exports only `r6`, typed as the existing `ModelProvider` from peer package `@callis/core`. The provider reports `version: '6.0.0-snapshot1'`. There are no runtime dependencies or network requests. Model metadata support does not add public model-aware evaluation: the engine evaluates with a model internally and its tests run model-aware evaluation against this provider (T0018), and the public model option remains T0038 work. This package makes no R6 FHIRPath conformance claim; there is no official R6 test suite.

The pinned core snapshots supply 196 roots (124 resource, 51 complex and 21 primitive types), including abstract bases, and 487 path-named backbones. [inventory.json](inventory.json) records every generated type by kind. Core constraint profiles and logical models are excluded. The package includes R6-specific types such as `DeviceAlert`, `DosageDetails` and `RelativeTime`; it does not reuse R5 data.

Elements include inherited fields in snapshot order, with snapshot cardinalities and allowed types. Choices use their FHIRPath names (`value`, without `[x]` or a JSON type suffix). Local `contentReference`s resolve to target backbones, including recursive `Questionnaire.item.item`. Primitives omit implicit `value`; metadata for their `id` and `extension` remains available. `date` maps to System `Date`, `integer64` to `Long`, and Quantity specializations to `Quantity` at the type level. Value conversion and primitive extension navigation belong to the evaluator. Returned metadata is frozen and shared.

The default entry point contains navigation metadata only. FHIR validation, terminology, slicing and other richer metadata are outside this package's scope.

See [SOURCE.md](SOURCE.md) for the exact source, checksum, upstream metadata caveats and license records, and [model-gen](../../tools/model-gen/README.md) for regeneration. The Callis package version is independent of the FHIR source version. Source package metadata and a changeset do not authorize a release; release ordering and inventory are decided separately before merge.
