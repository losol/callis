# Callis

A [FHIRPath](https://hl7.org/fhirpath/N1/) engine for TypeScript, with no runtime dependencies, for Node.js and browsers.

[Try the playground](https://callis.losol.no/playground/) · [Read the guide](docs/guide.md) · [Follow the progress](https://callis.losol.no/progress)

> **Before 1.0.** 0.x releases are published on npm, and the API can still change before 1.0. Public API is designed with later work in mind to avoid breaking changes, and a breaking change states its reason and migration ([API changes](CONTRIBUTING.md#api-changes), [releasing](RELEASING.md)).

FHIRPath is the path-based query language of HL7 FHIR. An expression such as `Patient.name.given` selects values from a FHIR resource, and FHIR uses such expressions in search parameters, invariants, mappings and other places that need to point at data. Callis evaluates them.

- **Correct.** It follows FHIRPath N1 and the FHIR additions ([ADR-0001](docs/adr/0001-spec-baseline.md)) and is measured against the official HL7 test suite.
- **Exact values.** Decimals are not binary floating point, partial dates and times keep their precision, and quantities respect units ([`@callis/ucum`](packages/ucum/README.md) adds full UCUM conversion).
- **Compile once, evaluate many times.** Built for repeated evaluation, such as search parameters, invariants and mappings.
- **Clear errors.** Every error has a stable code, and syntax errors point at the source position.
- **No model needed, better with one.** Plain JSON goes in and plain arrays come out. A FHIR model adds choice elements, the extensions of primitives and checks of element names.

## Status

Callis is at 0.x: published, partly implemented, and not yet 1.0. The public API evaluates synchronously, on plain JSON or with a FHIR model: paths, literals, indexing, operators and a first set of functions such as `where`, `exists` and `count`. Most of the standard function library is still to come, and calling a function that is not available raises an error instead of guessing. The [guide](docs/guide.md#current-support-and-deferred-api) lists what is supported, and the [conformance reports](https://callis.losol.no/conformance/r5) list every HL7 test that passes and fails.

This page and the guide follow the main branch, which can be ahead of the latest release. The [releases](https://github.com/losol/callis/releases) list what each one contains. The scope and criteria for 1.0 are not decided yet.

### FHIR versions

| FHIR | Support | Evidence |
| --- | --- | --- |
| R4 (4.0.1) | Supported | HL7 test suite, [report](https://callis.losol.no/conformance/r4) |
| R5 (5.0.0) | Supported | HL7 test suite, [report](https://callis.losol.no/conformance/r5) |
| R6 | Best effort | Built from the draft `6.0.0-snapshot1`, not final R6. There is no official R6 FHIRPath suite, so there is no R6 conformance result. |

Each version has a model package, listed [below](#packages), which the public API takes as its `model` option, for example for choice elements such as `value[x]` ([guide](docs/guide.md#fhir-models)).

## Install

```sh
npm install @callis/core
```

`@callis/core` is ESM only and needs Node.js 22 or later. It is also checked in a production Vite build in Chromium. Deno, Bun and edge workers are not verified yet. The other packages are optional and take `@callis/core` as a peer dependency.

## Quick start

Evaluate a resource given as plain JSON:

```ts
import { compile, evaluate } from '@callis/core';

export const patient: Readonly<{ resourceType: string; name: readonly { given: readonly string[] }[] }> = {
  resourceType: 'Patient', name: [{ given: ['Ada', 'Mina'] }],
};
export const given: unknown[] = evaluate(patient, 'Patient.name.given');
export const firstGiven: unknown[] = compile('name.given[0]').evaluate(patient);
```

`given` is `['Ada', 'Mina']` and `firstGiven` is `['Ada']`. Results are always plain arrays, and a path that finds nothing gives `[]`. `compile` parses once, and its result evaluates many resources. Errors extend `FhirPathError` and throw synchronously. Decimals come out as JavaScript numbers by default; use `decimalOutput: 'string'` when the exact digits matter ([guide](docs/guide.md#exact-decimal-rendering)).

## Packages

| Package | What it is |
| --- | --- |
| [`@callis/core`](packages/core/README.md) | The FHIRPath engine |
| [`@callis/ucum`](packages/ucum/README.md) | Opt-in full UCUM unit conversion |
| [`@callis/fhir-r4`](packages/fhir-r4/README.md), [`@callis/fhir-r5`](packages/fhir-r5/README.md) | Immutable model metadata for FHIR R4 and R5 |
| [`@callis/fhir-r6`](packages/fhir-r6/README.md) | Immutable model metadata from the R6 draft, best effort |

## Documentation

- [Guide](docs/guide.md): the public API, options, errors and exact decimals
- [Browser playground](https://callis.losol.no/playground/): run expressions in your browser; it executes locally and does not automatically send your input anywhere
- [Project progress](https://callis.losol.no/progress): the project commit by commit, with conformance and roadmap
- [Architecture](docs/architecture.md), [roadmap](docs/roadmap.md) and [decisions](docs/adr/README.md)
- [Spec notes](docs/spec-notes.md): how Callis reads the ambiguous parts of the specification

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains the workflow, and [AGENTS.md](AGENTS.md) has the rules for AI coding agents.

## License

[MIT](LICENSE). `@callis/ucum` includes the UCUM essence file under the UCUM License, and the FHIR model packages carry HL7 source notices; each package says so.
