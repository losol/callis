# @callis/core

A [FHIRPath](https://hl7.org/fhirpath/N1/) engine for TypeScript.

> **Work in progress.** Callis is not ready for use yet. The first release with an evaluation API will be 0.1.0. Until then the public API is incomplete, and any version may change it.

## Goals

- **Correct.** It follows FHIRPath N1 and the FHIR additions, and is checked against the official HL7 FHIRPath test suite.
- **No runtime dependencies.** One ESM build (ES2022) for Node.js 22 and later, browsers, Deno, Bun and edge workers.
- **Compile once, evaluate many times.** It is built for repeated evaluation, such as search parameters, invariants and mappings.
- **Works without a model, better with one.** Plain JSON is enough to get started. A FHIR R4 or R5 model adds choice types, type checks and primitive extensions.
- **Precise values.** It uses exact decimals instead of binary floating point, keeps the precision of partial dates and times, and respects units in quantities.

## Links

- [Architecture](https://github.com/losol/callis/blob/main/docs/architecture.md)
- [Roadmap](https://github.com/losol/callis/blob/main/docs/roadmap.md)
- [Contributing](https://github.com/losol/callis/blob/main/CONTRIBUTING.md)
- [Issues](https://github.com/losol/callis/issues)

## License

[MIT](https://github.com/losol/callis/blob/main/LICENSE)
