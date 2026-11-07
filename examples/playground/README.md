# Shared playground examples

`case-library.json` is the single authored source for the twelve teaching cases: the nine original presets and three new invented clinical-data excerpts. The inputs are not real patient data or validated complete FHIR resources. The questions demonstrate data selection, not diagnosis, treatment, identity verification or contact policy.

`schema.ts` validates the versioned JSON contract, unique stable IDs, narrative/provenance, declared function requirements and plain result/error expectations. Cases contain no executable callbacks, internal engine values, model providers or conformance adapters. Sources identify existing Callis test patterns at an immutable revision; the new clinical excerpts are original synthetic data, not copied official fixtures. This library uses the repository MIT license.

Both public `compile(...).evaluate(...)` and `evaluate(...)` execute these same cases in `packages/core/test/playground-examples.test.ts`. The site also checks the actual lazy data loader. Specialized security, identity, async, parser and fuzz tests remain independent.

The playground loads the small library as one separate data chunk only after entering the client-only route. Picker metadata is derived from the same data rather than duplicated into a second authored catalog. It uses the existing pinned Ratio SearchField/Select and JSON editor; Lectio/document routing remains unchanged.

## Expectations and editing

Every run uses `timezoneOffset: 0` and `decimalOutput: 'string'`. This preserves computed Decimal text; it cannot recover numeric digits already lost by JSON.parse. Output comparisons use structural plain values (array order and types matter, object key order does not). Expected errors compare JSON/expression phase and stable FHIRPath code, not engine message wording. They describe this public subset, not official conformance expectations.

Search by title, question or tags; load a case, edit, run and reset it. The original expectation stays visible after edits and is explicitly labelled as applying only to the original input/expression. Editing clears actual output and comparison; a modified run never receives a canonical-case match badge. A URL may contain only the allowlisted stable `example` ID; user input and expressions are not saved, uploaded or put in URLs.

To add a future case, edit the JSON source with all required fields and a stable unique ID, identify its synthetic origin/test/spec pattern, and run the public and browser checks. Do not add unsupported capability requirements or import tests into the browser. Any new engine capability, conformance explorer or release selection requires its own scope decision.
