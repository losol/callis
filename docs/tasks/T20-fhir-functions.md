# T20 — FHIR functions and variables

Part of the [roadmap](../roadmap.md). Phase 1 · wave 5 · size M.

- **Depends on:** [T9](T09-equality-kernels.md), [T18](T18-model-aware-evaluation.md)
- **Parallel with:** [T24](T24-static-analysis.md)

## Goal

The FHIR additions that need no host I/O ([variables](#variables), [R5 §2.1.9.1](https://hl7.org/fhir/R5/fhirpath.html#rules)).

## Scope

- `src/fhir/`:
  - `extension(url)`, `hasValue()`, `getValue()`
  - `resolve()` for local references only: contained `#id` against `%rootResource`, and Bundle `fullUrl` / `type/id` matching
  - `%resource` and `%rootResource` (derived from the parent chain, with override options), `%sct`, `%loinc`, `` %`vs-*` ``, `` %`ext-*` ``
  - FHIR equivalence (`id` ignored; `Coding` on `system` + `code`; `CodeableConcept` on intersecting codings) through the T9 extension point
  - FHIR `Quantity` → `System.Quantity` in operations
- Registering `memberOf`, `subsumes`, `subsumedBy`, `conformsTo` and `htmlChecks` as host-backed functions that return empty without a hook. The hook plumbing is T21.

## Design notes

### Variables

| Variable | Value | Source |
| --- | --- | --- |
| `%context` | the input passed to `evaluate()` | [N1 §9](https://hl7.org/fhirpath/N1/#environment-variables) |
| `%ucum` | `'http://unitsofmeasure.org'` | N1 §9 |
| `%resource` | the resource that contains `%context`. By default, the nearest ancestor with a `resourceType` (or the input itself); hosts can override it. | [R5 §2.1.9.1.4](https://hl7.org/fhir/R5/fhirpath.html#variables) |
| `%rootResource` | the container of `%resource` if it is contained, otherwise `%resource` | R5 §2.1.9.1.4 |
| `%sct` | `'http://snomed.info/sct'` | [R5 §2.1.9.1.7](https://hl7.org/fhir/R5/fhirpath.html#vars) |
| `%loinc` | `'http://loinc.org'` | R5 §2.1.9.1.7 |
| `` %`vs-[name]` `` | `'http://hl7.org/fhir/ValueSet/[name]'` | R5 §2.1.9.1.7 |
| `` %`ext-[name]` `` | `'http://hl7.org/fhir/StructureDefinition/[name]'` | R5 §2.1.9.1.7 |
| user variables | from the `variables` option: JSON values, `ModelNode`s or arrays | N1 §9 |

An undefined variable raises `eval/undefined-variable`. A defined variable whose value is `undefined`, `null` or `[]` is empty, as N1 §9 requires. If the names are declared at compile time (the `knownVariables` option, [T25: public API sketch](T25-public-api-release.md#public-api-sketch)), the analyzer can check them early. The values are always supplied at evaluation time.

## Acceptance criteria

- [ ] `Patient.birthDate.extension('http://…').value` works. `hasValue()` and `getValue()` behave correctly for extension-only primitives.
- [ ] `resolve()` finds contained resources and Bundle entries, and returns empty otherwise without an error.
- [ ] Conformance groups: `testExtension`, `testHasValue`, `testDollarResource`, `testVariables`, `primitivesWithoutValue`.
