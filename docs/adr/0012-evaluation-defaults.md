# ADR-0012: Evaluation and output defaults

- **Status:** Accepted (owner review, 2026-11-03)
- **Date:** 2026-11-03

## Context

Some behaviour is left to the implementation or is a trade-off between spec strictness, determinism and compatibility with other engines:

- **Timezone.** When a date/time value without an offset is compared with one that has an offset, an offset must be assumed. [N1](https://hl7.org/fhirpath/N1/#datetime-equality) leaves this to the implementation and suggests the server's local offset. That makes results depend on the machine the code runs on.
- **Decimal in plain output.** Callis keeps decimals exact internally, but most callers want ordinary JavaScript values. A `number` is convenient and matches `fhirpath.js`, but it can lose precision; a string is exact but less convenient.
- **Choice-type suffixes.** The spec says `Observation.valueQuantity` is not valid FHIRPath (use `Observation.value.ofType(Quantity)`), but other engines accept it.

## Decision

The owner decided these defaults on 2026-11-03:

1. **Timezone: UTC.** A date/time value without an offset is treated as UTC (offset 0) when it has to be compared with or converted against a value that has one. The `timezoneOffset` option (minutes) overrides this per evaluation, and `timezoneOffset: 'local'` uses the host's offset. `today()` and `timeOfDay()` are also computed in the evaluation's offset, so they are UTC by default.
2. **Decimal in plain output: `number`.** `decimalOutput: 'string'` and `output: 'typed'` give exact results.
3. **Choice types: strict.** With a model, `Observation.valueQuantity` is a semantic error (static analysis) or empty (runtime), as the spec requires. `lenient: { choiceSuffix: true }` accepts it for compatibility.

## Consequences

- Results are the same on every machine, and tests do not need a fixed timezone. Hosts that want local-time semantics must ask for them with `timezoneOffset: 'local'`.
- Plain output is easy to use, but callers who need exact decimals must opt in. This is documented next to the output modes.
- Expressions written for lenient engines may need `ofType()` or the `lenient` option. The conformance runner uses the strict default, except for tests in `mode="lenient/polymorphics"`.
- Details live in [T0005](../tasks/T0005-date-time.md) (timezone), [T0017](../tasks/T0017-fn-tree-utility.md) (`today()`/`now()`), [T0018](../tasks/T0018-model-aware-evaluation.md) (choice types) and [T0025](../tasks/T0025-public-api-release.md) (options and output).
