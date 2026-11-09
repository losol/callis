# Generated FHIR R5 data

`src/model-data.ts` is derived from the snapshots in **hl7.fhir.r5.core@5.0.0**, produced by HL7 Inc.

- Archive: <https://packages.fhir.org/hl7.fhir.r5.core/5.0.0>
- SHA-256: `74b27cd1bfce9e80eaceac431edf230b0945a443564fbf5512f82e5fa50a80d4`
- Specification: <https://hl7.org/fhir/R5/>
- Source package license: **CC0-1.0** (verified from `package/package.json`).
- Copyright © 2011+ HL7. License and trademark terms: <https://hl7.org/fhir/R5/license.html#license>.
- CC0 1.0 Universal: <https://creativecommons.org/publicdomain/zero/1.0/legalcode>.

The archive gives the `id` of 46 datatypes (`Address.id`, `Age.id`, …) the type `id`, although they inherit `Element.id`, a `string`. The model takes the type of an inherited element from the element that defines it ([spec notes](../../docs/spec-notes.md#the-id-of-a-resource-is-an-id-the-id-of-any-other-element-a-string)).

This is a derived navigation model, not the FHIR specification or a validation model. Terminology tables, bindings, invariants and richer phase-2 metadata are excluded. FHIR® and HL7® are trademarks of Health Level Seven International; no endorsement is implied.

Regenerate with `pnpm --filter @callis/model-gen generate`. See [the generator](../../tools/model-gen/README.md). Do not edit the generated output by hand. Package implementation code is MIT licensed; this source-data notice is included in the published package.
