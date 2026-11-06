# Callis

> Work in progress. Not ready for use yet.

Callis is about finding data. It is a [FHIRPath](https://hl7.org/fhirpath/N1/) engine for TypeScript, with no runtime dependencies, for Node.js and browsers.

## Documentation

- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md) (and [AGENTS.md](AGENTS.md) for AI agents)

## Packages

| Package | Description | Status |
| --- | --- | --- |
| [`@callis/core`](packages/core) | The FHIRPath engine | In development |
| [`@callis/ucum`](packages/ucum) | Opt-in UCUM conversion | Implemented; release preparation pending |
| [`@callis/fhir-r4`](packages/fhir-r4), [`@callis/fhir-r5`](packages/fhir-r5) | Immutable R4 4.0.1 / R5 5.0.0 provider metadata | Implemented data packages; public model-aware evaluation deferred |

## Install

The first stable release, 0.1.0, will offer the implemented subset through a [small synchronous API](docs/tasks/T0025-public-api-release.md) and [simple playground](docs/tasks/T0036-playground.md), after [release readiness](docs/tasks/T0037-first-release-readiness.md). It does not wait for full phase 1. Later 0.x releases will add capabilities with documented support, limitations and per-phase [conformance reports](docs/conformance/r5.md). The scope and criteria for 1.0 remain open.

Once a supported stable release is available:

```sh
npm install @callis/core
```

## Quick start

The source/build exports synchronous model-less evaluation. See the [guide](docs/guide.md) for supported features, errors and exact Decimal rendering; this does not announce a published release.

```ts
import { compile, evaluate, FhirPathError } from '@callis/core';

export const patient: Readonly<{ resourceType: string; name: readonly { given: readonly string[] }[] }> = {
  resourceType: 'Patient', name: [{ given: ['Ada', 'Mina'] }],
};
export const given: unknown[] = evaluate(patient, 'Patient.name.given');
export const firstGiven: unknown[] = compile('name.given[0]').evaluate(patient);
```

These return `['Ada', 'Mina']` and `['Ada']`. Default Decimal output uses potentially lossy numbers; `decimalOutput: 'string'` preserves evaluator Decimal digits, but cannot recover digits lost in input JavaScript numbers. Full phase-1 conformance and model-aware evaluation remain future work.

## First 0.1 support

The [support matrix](docs/guide.md#first-01-support-matrix) lists implemented operators and functions, tested runtimes and deferred APIs. Try the [browser-local playground](https://callis.losol.no/playground/); it executes locally without automatically sending input JSON. See the [release inventory and owner gates](docs/releases/0.1.0.md) before treating this preparation as a published release.

## License

[MIT](LICENSE)
