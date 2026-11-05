# FHIR model generator

Generates the navigation models in `@callis/fhir-r4` and `@callis/fhir-r5` from official, pinned FHIR core package snapshots. Generated output is committed; normal builds and tests need no network.

```sh
pnpm --filter @callis/model-gen generate
pnpm --filter @callis/model-gen generate --check
pnpm test --project model-gen --project fhir-r4 --project fhir-r5
pnpm build
pnpm check:packages
```

The first generation downloads `hl7.fhir.r4.core@4.0.1` and `hl7.fhir.r5.core@5.0.0` from `https://packages.fhir.org`. Archives are cached in ignored `tools/model-gen/.cache/` and checked against committed SHA-256 pins on every run before extraction. Node and `tar` are development requirements. Delete a damaged cached archive and retry; an intentional upstream update requires reviewing the pin, version and package source notices together. CI regenerates on relevant pull requests/pushes and manual dispatch.

The generator selects base primitive, complex and resource definitions, not constraint profiles or logical models. It emits sorted type rows with complete direct-child snapshots in definition order, so constrained inherited fields keep their snapshot types/cardinalities. Inline children become path-named backbone types; local `contentReference` targets resolve to those types, including recursive links. Missing snapshots, unknown bases/types, cycles and unsupported shapes fail generation. Source System types normalize to model types using the source FHIR-type extension (with canonical primitive fallbacks).

The private tuple format is `[name, kind, baseName|null, abstract, systemType|null, elements]`. Elements are `[name, typeNames, flags]`, with array=1 and choice=2. Tuples are deliberately not public API. A shared builder is bundled privately into each package, precomputing frozen type/element objects and lookup indexes. No required core interface changes, runtime dependency or phase-2 metadata is introduced.

The existing core contract suite runs against both providers, starting at every generated resource/datatype root. Additional acceptance tests cover recursive references, choices, normalized primitive fields and immutability. Generator tests use synthetic snapshots without network; `--check` verifies the full official archives produce byte-identical committed output. The package size report enforces 60 KiB gzip for each built model, including its provider code.

Source and license records are next to each generated package in `SOURCE.md`, which is also shipped in the package. The official FHIR definition data is CC0-1.0; the generator and provider implementation are MIT licensed.
