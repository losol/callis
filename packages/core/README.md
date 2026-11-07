# @callis/core

A [FHIRPath](https://hl7.org/fhirpath/N1/) engine for TypeScript.

> **Work in progress.** The initial API supports synchronous model-less evaluation. Full phase-1 conformance, a public model option and async evaluation remain future work. These examples do not imply a published release; 0.x changes may extend or change the API.

## Goals

- **Correct.** It follows FHIRPath N1 and the FHIR additions, and is checked against the official HL7 FHIRPath test suite.
- **No runtime dependencies.** One ESM build (ES2022). Node 22/24/26 and a production Vite/Chromium consumer are checked; Deno, Bun and edge workers are not verified for 0.1.
- **Compile once, evaluate many times.** It is built for repeated evaluation, such as search parameters, invariants and mappings.
- **Works without a model, better with one.** The public API currently evaluates plain JSON only. The engine evaluates with the R4/R5 providers internally (choice elements, FHIR primitives and their extensions, inheritance), which the conformance runner uses; the public `model` option is deferred to the expanded API.
- **Precise values.** It uses exact decimals instead of binary floating point, keeps the precision of partial dates and times, and respects units in quantities.

## Quick start

```ts
import { compile, evaluate, FhirPathError, parseJson } from '@callis/core';

export const patient: Readonly<{ resourceType: string; name: readonly { given: readonly string[] }[] }> = {
  resourceType: 'Patient', name: [{ given: ['Ada', 'Mina'] }],
};
export const given: unknown[] = evaluate(patient, 'Patient.name.given');
export const firstGiven: unknown[] = compile('name.given[0]').evaluate(patient);
```

Results are plain arrays (`['Ada', 'Mina']` and `['Ada']` here). Decimal output defaults to potentially lossy numbers. Use `decimalOutput: 'string'` for exact evaluator Decimal and Quantity magnitudes; it cannot restore digits already lost in input numbers. Errors extend `FhirPathError` and throw synchronously. See the [public API guide](https://github.com/losol/callis/blob/main/docs/guide.md) for options, errors, supported functions and deferred capabilities.

## Filtering and existence increment

The current synchronous API also supports `where(criteria)` on model-less JSON:

```ts
export const filteredGiven: unknown[] = evaluate(patient, "name.where(given[0] = 'Ada').given");
```

Filtering preserves input order, duplicates and input object identity. Criteria use FHIRPath singleton Boolean semantics; false/empty excludes an item and a multi-item criterion raises `eval/singleton-expected`. The existing single non-Boolean fallback is true. No public options or async surface are added. This is an implementation update, not a publication announcement; the 0.1 subset below describes the original release.

`exists([criteria])` and `count()` compose with filtering through the same public API:

```ts
export const numberOfNames: unknown[] = evaluate(patient, 'name.count()');
export const hasAda: unknown[] = compile("name.exists(given[0] = 'Ada')").evaluate(patient);
export const filteredNameCount: unknown[] = evaluate(patient, "name.where(given[0] = 'Ada').count()");
```

Empty input gives false for existence and zero for count. Optional existence criteria use the same singleton Boolean contract as where, and stop after the first match. These functions add no new API options, model awareness or public async behavior.

`first()` returns the first item in input order. `single()` returns the item only when there is at most one; multiple items raise `eval/singleton-expected`, including duplicate items. Both return empty for empty input and preserve the selected input object and its provenance.

```ts
export const selectedGiven: unknown[] = evaluate(patient, 'name.given.first()');
export const onlyName: unknown[] = compile('name.single()').evaluate(patient);
```

These zero-argument functions use the existing synchronous model-less API. The remaining subsetting and combining functions, including `last()`, remain deferred.

## Lossless JSON input

`JSON.parse` turns `1.50` into `1.5`, and FHIRPath can see the difference. `parseJson(text)` keeps every number as written, as a `JsonNumber`, and evaluation treats it as the Integer or Decimal it denotes:

```ts
export const lossless: unknown[] = evaluate(parseJson('{"value": 1.50}'), 'value', {
  decimalOutput: 'string',
});
```

This gives `['1.50']`; without `decimalOutput: 'string'` the result is the number `1.5`. Invalid text raises a `FhirPathEvaluationError` with the code `eval/invalid-json`. Objects in results keep their `JsonNumber` values, which `JSON.stringify` writes as numbers again.

## First 0.1 subset

Paths, literals, indexing, unary polarity, arithmetic, comparisons, equality/equivalence, membership/union, Boolean logic and system type operations are implemented. The only built-in functions are `not`, `is`, `as` and `ofType`; collection/filter/string/math/FHIR function groups are deferred. Exact Decimal string output is opt-in; input JavaScript number precision cannot be recovered. No public model option, async, hooks, analyzer, parser/AST or typed-output API is included.

See the [version-specific support matrix](https://github.com/losol/callis/blob/main/docs/guide.md#first-01-support-matrix) and [release inventory](https://github.com/losol/callis/blob/main/docs/releases/0.1.0.md). Internal-adapter conformance is partial and does not certify this public model-less subset as fully FHIRPath compliant.

## Links

- [Architecture](https://github.com/losol/callis/blob/main/docs/architecture.md)
- [Roadmap](https://github.com/losol/callis/blob/main/docs/roadmap.md)
- [Contributing](https://github.com/losol/callis/blob/main/CONTRIBUTING.md)
- [Issues](https://github.com/losol/callis/issues)

## License

[MIT](https://github.com/losol/callis/blob/main/LICENSE)
