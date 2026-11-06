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
| `@callis/ucum` | The full UCUM unit system | Planned ([T0007](docs/tasks/T0007-ucum.md)) |
| `@callis/fhir-r4`, `@callis/fhir-r5` | FHIR R4 and R5 models | Planned ([T0019](docs/tasks/T0019-fhir-model-generator.md)) |

## Install

The first stable release, 0.1.0, will offer the implemented subset through a [small synchronous API](docs/tasks/T0025-public-api-release.md) and [simple playground](docs/tasks/T0036-playground.md), after [release readiness](docs/tasks/T0037-first-release-readiness.md). It does not wait for full phase 1. Later 0.x releases will add capabilities with documented support, limitations and per-phase [conformance reports](docs/conformance/r5.md). The scope and criteria for 1.0 remain open.

Once a supported stable release is available:

```sh
npm install @callis/core
```

## License

[MIT](LICENSE)
