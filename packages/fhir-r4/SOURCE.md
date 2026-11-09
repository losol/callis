# Generated FHIR R4 data

`src/model-data.ts` is derived from the snapshots in **hl7.fhir.r4.core@4.0.1**, produced by HL7 Inc.

- Archive: <https://packages.fhir.org/hl7.fhir.r4.core/4.0.1>
- SHA-256: `ebd7731df7d36b5b7d39d5fb6c9d77b44bb7fe5742f1a2e87f164738c3289d44`
- Specification: <https://hl7.org/fhir/R4/>
- Source package license: **CC0-1.0** (verified from `package/package.json`).
- Copyright © 2011+ HL7. License and trademark terms: <https://hl7.org/fhir/R4/license.html#license>.
- CC0 1.0 Universal: <https://creativecommons.org/publicdomain/zero/1.0/legalcode>.

One value differs from the archive. The archive gives `Resource.id` the type `string`, but the [published definition](https://hl7.org/fhir/R4/resource-definitions.html#Resource.id) says `id`, as R5 and R6 do, so the model types the `id` of every resource as `id`. The generator carries this correction explicitly and fails if the archive changes ([spec notes](../../docs/spec-notes.md#the-id-of-a-resource-is-an-id-the-id-of-any-other-element-a-string)).

This is a derived navigation model, not the FHIR specification or a validation model. Terminology tables, bindings, invariants and richer phase-2 metadata are excluded. FHIR® and HL7® are trademarks of Health Level Seven International; no endorsement is implied.

Regenerate with `pnpm --filter @callis/model-gen generate`. See [the generator](../../tools/model-gen/README.md). Do not edit the generated output by hand. Package implementation code is MIT licensed; this source-data notice is included in the published package.
