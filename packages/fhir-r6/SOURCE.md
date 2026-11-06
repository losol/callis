# Generated FHIR R6 draft snapshot data

`src/model-data.ts` and `inventory.json` are derived from the official snapshots in **hl7.fhir.r6.core@6.0.0-snapshot1**, produced by HL7 Inc. This is the **September 2026 R6 draft snapshot**, not a final R6 release.

- Archive: <https://hl7.org/fhir/6.0.0-snapshot1/hl7.fhir.r6.core.tgz> (linked by the versioned [downloads page](https://hl7.org/fhir/6.0.0-snapshot1/downloads.html)).
- Official registry mirror: <https://packages2.fhir.org/packages/hl7.fhir.r6.core/6.0.0-snapshot1>.
- SHA-256: `c67aad1c83851aa7702f10a210f9e0e2c9fb0a54dcd43fd0826296dc6a175f59` (both independently downloaded archives match).
- Specification: <https://hl7.org/fhir/6.0.0-snapshot1/>.
- Manifest identity: `hl7.fhir.r6.core`, version and sole `fhirVersions` entry `6.0.0-snapshot1`, date `20260910165024`.
- Source package license: **CC0-1.0**, verified from `package/package.json`.
- Copyright © 2011+ HL7. [License and trademark terms](https://hl7.org/fhir/6.0.0-snapshot1/license.html#license); [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/legalcode).

The manifest contains stale metadata: `url` points to `http://hl7.org/fhir/6.0.0-ballot5` and `homepage` is a local filesystem URL. The [publication list](https://hl7.org/fhir/package-list.json) also carries a snapshot date different from the archive/registry September build date. These are upstream inconsistencies; identity is established by the exact archive bytes, manifest version/FHIR version and versioned published download, not those stale fields. The older `packages.fhir.org` R6 endpoint returned 404 during the 2026-11-06 source audit. Generation uses the explicit versioned HL7 URL above and fails on checksum or identity/license mismatch; it never falls back to floating builds or R5.

The selected base snapshots yield 124 resource roots, 51 complex datatype roots, 21 primitive roots and 487 backbones (683 types total). `inventory.json` lists every selected root and generated backbone by kind in sorted order. Constraint profiles and logical models are excluded. Regeneration checks the inventory as well as the data and shared provider copy.

This is a derived navigation model, not the FHIR specification or a FHIR validation model. Terminology tables, bindings, invariants and richer metadata are excluded. FHIR® and HL7® are trademarks of Health Level Seven International; no endorsement is implied. The provider implementation is MIT licensed; the source-data notice is shipped with the package.

Regenerate with `pnpm --filter @callis/model-gen generate`; verify with `pnpm --filter @callis/model-gen generate --check`. See [the generator](../../tools/model-gen/README.md). Do not edit generated output by hand. Updating the FHIR revision requires reviewing its version, source URL, checksum, inventory, tests and this notice together.
