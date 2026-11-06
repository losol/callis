# @callis/core

A [FHIRPath](https://hl7.org/fhirpath/N1/) engine for TypeScript.

> **Work in progress.** The initial API supports synchronous model-less evaluation. Full phase-1 conformance, model-aware evaluation and async evaluation remain future work. These examples do not imply a published release; 0.x changes may extend or change the API.

## Goals

- **Correct.** It follows FHIRPath N1 and the FHIR additions, and is checked against the official HL7 FHIRPath test suite.
- **No runtime dependencies.** One ESM build (ES2022) for Node.js 22 and later, browsers, Deno, Bun and edge workers.
- **Compile once, evaluate many times.** It is built for repeated evaluation, such as search parameters, invariants and mappings.
- **Works without a model, better with one.** Plain JSON is enough to get started. A FHIR R4 or R5 model adds choice types, type checks and primitive extensions.
- **Precise values.** It uses exact decimals instead of binary floating point, keeps the precision of partial dates and times, and respects units in quantities.

## Quick start

```ts
import { compile, evaluate, FhirPathError } from '@callis/core';

export const patient: Readonly<{ resourceType: string; name: readonly { given: readonly string[] }[] }> = {
  resourceType: 'Patient', name: [{ given: ['Ada', 'Mina'] }],
};
export const given: unknown[] = evaluate(patient, 'Patient.name.given');
export const firstGiven: unknown[] = compile('name.given[0]').evaluate(patient);
```

Results are plain arrays (`['Ada', 'Mina']` and `['Ada']` here). Decimal output defaults to potentially lossy numbers. Use `decimalOutput: 'string'` for exact evaluator Decimal and Quantity magnitudes; it cannot restore digits already lost in input numbers. Errors extend `FhirPathError` and throw synchronously. See the [public API guide](https://github.com/losol/callis/blob/main/docs/guide.md) for options, errors, supported functions and deferred capabilities.

## Links

- [Architecture](https://github.com/losol/callis/blob/main/docs/architecture.md)
- [Roadmap](https://github.com/losol/callis/blob/main/docs/roadmap.md)
- [Contributing](https://github.com/losol/callis/blob/main/CONTRIBUTING.md)
- [Issues](https://github.com/losol/callis/issues)

## License

[MIT](https://github.com/losol/callis/blob/main/LICENSE)
