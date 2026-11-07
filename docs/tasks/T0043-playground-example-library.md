# T0043 — Shared playground example library

Part of the [roadmap](../roadmap.md). Phase 3 · wave 7 · size M.

- **Depends on:** [T0036](T0036-playground.md), [T0011](T0011-fn-existence.md)
- **Issue:** [#139](https://github.com/losol/callis/issues/139)
- **Background:** [T0012](T0012-fn-filtering.md), [ADR-0012](../adr/0012-evaluation-defaults.md)

## Goal

Teach the implemented public FHIRPath subset with one synthetic example library consumed by both CI and the existing playground. This is an independently scoped site/tooling increment, with no selected release, milestone or due date.

## Scope

- Migrate and enrich the nine existing presets as pure data. Add exactly three clinical-data questions: official given names, the count of final Observation resources, and whether an excerpt contains a phone entry. Use invented data, explanatory narrative, questions and edge cases; no diagnosis, treatment rules or real patient data.
- Give cases stable IDs, titles/summaries, input JSON text, expressions, expected results or stable error phase/code, explanations, tags, source/provenance and minimal supported-function requirements. Keep the schema small and validate it; no future decoders, arbitrary test code or full suite imports.
- Have CI run each shared case through both public compile and evaluate with deterministic timezone 0 and exact computed Decimal strings. Preserve input JSON.parse limitations and keep specialized unit/security/identity/fuzz/async tests independent.
- Use pinned Ratio primitives for a simple searchable picker. Load a selected case, edit, run and reset it; show its narrative and original expected outcome beside actual output. Clear stale outputs/comparisons on edits, indicate modified input/expression, and never call an edited run a canonical-case pass.
- Keep escaped results and invalid-JSON/expression errors distinct, retaining stable structured codes for comparisons. A linkable allowlisted case ID is useful; do not put user JSON or expressions in URLs, storage, telemetry or remote requests.
- Retain React Router, Lectio and the existing browser-only editor/evaluator boundary. Keep metadata small and case payloads lazy where justified. Verify docs startup, actual route/data chunk costs, direct-route prerender/hydration, keyboard/focus, theme, mobile and the previous margin regression.

## Exclusions and reuse

No conformance explorer, internal runner, new engine functions, model option, public async, lossless JSON parser, upstream implementation, dependency upgrade, diff framework or generic interactive-documentation framework. The nine existing presets must keep their original input/expression/results.

Callis owns example data, FHIRPath execution and comparison. Ratio already supplies picker/editor/display primitives; Lectio supplies current content/search integration. Optional upstream [Ratio #319](https://github.com/losol/ratio-ui/issues/319), [#320](https://github.com/losol/ratio-ui/issues/320), [#321](https://github.com/losol/ratio-ui/issues/321) and [Lectio #62](https://github.com/losol/lectio-docs/issues/62) remain separate, not dependencies of this task. Preserve existing source/license notices.

## Acceptance criteria

- [ ] Nine original and three new synthetic cases are schema-valid, uniquely identified, documented and consumed by CI and the playground from one source.
- [ ] Public compile/evaluate agree with each case's declared result or error code; expected errors are Callis subset contracts, not invented conformance expectations.
- [ ] Search and empty results, case loading/deep links/reset, edits/stale state and expected-versus-actual/error recovery work without persisting or transmitting user input.
- [ ] Browser tests cover keyboard/focus/labels, escaping, both themes, mobile/layout stability, direct-route hydration and lazy docs/playground loading; actual production preview and bundle measurements are recorded.
- [ ] Full pnpm check, site production/browser checks, relevant public/package checks and conformance pass without a baseline regression. No published package/API behavior or version changes.
- [ ] Roadmap consistency and normal sync dry-run impact are reviewed; no broad sync apply, automatic release assignment, settings changes, merge or publication.

## Implementation notes

The small authored library uses one separately loaded raw-JSON chunk. Picker metadata is derived from those same twelve cases when the playground loads, avoiding a duplicate catalog or a per-case request/generator framework. Public API tests and the browser loader share schema validation and deterministic options. The run display retains structured values/phase/code for comparison; modified runs retain the original expectation only as a labelled reference.

Normal roadmap sync remains a dry-run review step, including the new issue's dependencies and project fields. It can also propose pre-existing unrelated drift; this implementation does not apply it or change tokens. T0043 has no selected release.
