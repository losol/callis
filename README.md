# Callis

> **Before 1.0.** 0.x releases are published on npm, and the API can still change before 1.0. Public API is designed with later work in mind to avoid breaking changes, and a breaking change states its reason and migration ([API changes](CONTRIBUTING.md#api-changes), [releasing](RELEASING.md)).

Callis is about finding data. It is a [FHIRPath](https://hl7.org/fhirpath/N1/) engine for TypeScript, with no runtime dependencies, for Node.js and browsers.

## Documentation

- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md) (and [AGENTS.md](AGENTS.md) for AI agents)

## Packages

| Package | Description | Status |
| --- | --- | --- |
| [`@callis/core`](packages/core) | The FHIRPath engine | In development; 0.x releases of the implemented subset |
| [`@callis/ucum`](packages/ucum) | Opt-in UCUM conversion | Implemented and released |
| [`@callis/fhir-r4`](packages/fhir-r4), [`@callis/fhir-r5`](packages/fhir-r5) | Immutable R4 4.0.1 / R5 5.0.0 provider metadata | Released data packages; the engine evaluates with them internally, public `model` option deferred |
| [`@callis/fhir-r6`](packages/fhir-r6) | Immutable provider metadata from the R6 draft `6.0.0-snapshot1` | Released data package, best effort: a draft, not final R6, and there is no R6 conformance suite |

## Install

The first release, 0.1.0, offered the implemented subset through a [small synchronous API](docs/tasks/T0025-public-api-release.md) and [simple playground](docs/tasks/T0036-playground.md), after [release readiness](docs/tasks/T0037-first-release-readiness.md). It did not wait for full phase 1. Later 0.x releases add capabilities with documented support, limitations and per-phase [conformance reports](docs/conformance/r5.md); the [releases](https://github.com/losol/callis/releases) list what each one contains. The scope and criteria for 1.0 remain open.

```sh
npm install @callis/core
```

## Quick start

The source exports synchronous model-less evaluation. See the [guide](docs/guide.md) for supported features, errors and exact Decimal rendering; the main branch can be ahead of the latest release.

```ts
import { compile, evaluate, FhirPathError, parseJson } from '@callis/core';

export const patient: Readonly<{ resourceType: string; name: readonly { given: readonly string[] }[] }> = {
  resourceType: 'Patient', name: [{ given: ['Ada', 'Mina'] }],
};
export const given: unknown[] = evaluate(patient, 'Patient.name.given');
export const firstGiven: unknown[] = compile('name.given[0]').evaluate(patient);
```

These return `['Ada', 'Mina']` and `['Ada']`. Default Decimal output uses potentially lossy numbers; `decimalOutput: 'string'` preserves evaluator Decimal digits, but cannot recover digits lost in input JavaScript numbers; `parseJson()` keeps them ([guide](docs/guide.md#lossless-json-input)). Full phase-1 conformance and a public model option remain future work.

## First 0.1 support

The [support matrix](docs/guide.md#first-01-support-matrix) lists implemented operators and functions, tested runtimes and deferred APIs. Try the [browser-local playground](https://callis.losol.no/playground/); it executes locally without automatically sending input JSON. The [0.1.0 release inventory](docs/releases/0.1.0.md) records what that release contains and how it was prepared.

## License

[MIT](LICENSE)
