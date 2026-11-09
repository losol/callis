# T0020 — FHIR functions and variables

Part of the [roadmap](../roadmap.md). Phase 1 · wave 5 · size M.

- **Depends on:** [T0009](T0009-equality-kernels.md), [T0018](T0018-model-aware-evaluation.md)
- **Area:** `area:functions`, `area:core`
- **Tier hint:** likely `risk:high`: the override options for `%resource` and `%rootResource` change the public evaluation options, so the core tier with a second reviewer from the other vendor.
- **Parallel with:** [T0024](T0024-static-analysis.md)

## Goal

The FHIR additions that need no host I/O ([variables](#variables), [R5 §2.1.9.1](https://hl7.org/fhir/R5/fhirpath.html#rules)).

## Scope

- `src/fhir/`:
  - `extension(url)`, `hasValue()`, `getValue()`
  - `resolve()` for local references only: contained `#id` against `%rootResource`, and Bundle `fullUrl` / `type/id` matching
  - `%resource` and `%rootResource` (derived from the parent chain, with override options), `%sct`, `%loinc`, `` %`vs-*` ``, `` %`ext-*` ``
  - FHIR equivalence (`id` ignored; `Coding` on `system` + `code`; `CodeableConcept` on intersecting codings) through the T0009 extension point
  - FHIR `Quantity` → `System.Quantity` in operations, including two FHIR Quantities of which one has no UCUM code: a quantity with only unit text against a UCUM-coded one, and the ordering of two without a code (`testLessThan33`, `testLessOrEqual30`, `testGreaterThan30`; [#150](https://github.com/losol/callis/issues/150), [spec notes](../spec-notes.md#fhir-quantities-without-a-ucum-code))
- Registering `memberOf`, `subsumes`, `subsumedBy`, `conformsTo` and `htmlChecks` as host-backed functions that return empty without a hook. The hook plumbing is T0021.
- **FHIR versions** ([roadmap](../roadmap.md#fhir-versions)): R4 ([§2.9.1.5](https://hl7.org/fhir/R4/fhirpath.html#functions)), R5 ([§2.1.9.1.5](https://hl7.org/fhir/R5/fhirpath.html#functions)) and the R6 draft ([§2.1.9.3](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#functions)) define these functions and variables the same way, so the engine has no version-specific code. The cases that need a model also run against the real `r4`, `r5` and `r6` providers in `packages/core/test/generated-models.test.ts`: `extension()` and `hasValue()` on a primitive with only extensions, `%resource` and `%rootResource` in a contained resource, `Coding` and `CodeableConcept` equivalence, and `resolve()` of a contained R6-only `DeviceAlert`, which is typed under R6, and under R4 and R5 has the declared type of `contained`, `Resource`, as navigation gives it ([T0018 navigation rule 2](T0018-model-aware-evaluation.md#navigation-rules)), so its R6-only elements are not navigable.
- **Not in this task:** the R6 draft adds `weight()` ([§2.1.9.3.13](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#fn-weight)), which needs cross-resource lookups and is on the [roadmap backlog](../roadmap.md#backlog-not-scheduled) until final R6 ([#151](https://github.com/losol/callis/issues/151)), and a `%profile` variable for profile invariants ([§2.1.9.2](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#variables)). Hosts can already pass `%profile` through `variables`; this task builds in no value for it.

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

An undefined variable raises `eval/undefined-variable`. A defined variable whose value is `undefined`, `null` or `[]` is empty, as N1 §9 requires. If the names are declared at compile time (the `knownVariables` option, [T0025: public API sketch](T0025-public-api-release.md#public-api-sketch)), the analyzer can check them early. The values are always supplied at evaluation time.

The interpretations this task made are in the [spec notes](../spec-notes.md#fhir-functions): how `%resource` and `%rootResource` follow the parent chain, why `hasValue()` is always a Boolean, which references `resolve()` finds locally, and how `~` applies FHIR's equivalence rules.

## Acceptance criteria

- [x] `Patient.birthDate.extension('http://…').value` works. `hasValue()` and `getValue()` behave correctly for extension-only primitives.
- [x] `resolve()` finds contained resources and Bundle entries, and returns empty otherwise without an error.
- [x] The same FHIR function and variable cases pass against the real `r4`, `r5` and `r6` providers, including the contained `DeviceAlert` typed under R6 only. No R6 conformance result is claimed, and no R6 suite exception is registered.
- [x] Conformance groups: `testExtension`, `testHasValue`, `testDollarResource`, `testVariables` (R4 and R5), and `primitivesWithoutValue` (R5 suite only) pass, except for the tests that need functions of other tasks: `testExtension3` (`empty()`, [T0041](T0041-fn-existence-completion.md)) and `testValueLength` (`last()`, [T0013](T0013-fn-subsetting-combining.md)). Both suites have the `testDollarResource` group only inside an XML comment, so it has no tests; `%resource` is covered by `isGuardAndOtherImplies`, `isGuardOtherAndImplies`, `isGuardOrInnerImplies` and `testMultipleResolve`. `testLessThan33`, `testLessOrEqual30` and `testGreaterThan30` pass too ([#150](https://github.com/losol/callis/issues/150)).
