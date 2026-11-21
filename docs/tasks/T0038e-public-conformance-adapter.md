# T0038e — Conformance runner on the public API

Part of the [roadmap](../roadmap.md). Phase 1 · wave 8 · size S.

- **Depends on:** [T0038a](T0038a-public-model-options.md), [T0038b](T0038b-public-async-hooks-limits.md), [T0038c](T0038c-public-parser-cache.md), [T0038d](T0038d-public-typed-output.md)
- **Area:** `area:tooling`
- **Tier hint:** the tooling tier; a lost baseline entry or a changed exception raises `risk:high`.
- **Parallel with:** [T0038f](T0038f-phase-1-documentation.md)
- **Parent:** [T0038](T0038-public-api-completion.md), split on 2026-11-12.

## Goal

Measure the published surface: the conformance runner's adapter evaluates through the public `@callis/core` API instead of the internal API of [T0008](T0008-compiler-evaluator.md), as the [parent](T0038-public-api-completion.md#scope) requires.

## Scope

- `tools/conformance/src/engine-adapter.ts` uses the public `analyze()`, `compile()` and `evaluateAsync()` with the `model`, `inputType`, `lenient`, `strict`, `units` and `hooks` options and typed output, and its name in the reports says so.
- What still needs internals is listed with the reason: the detection of planned functions (the registry), the description of typed values for comparison if the public types do not cover it, and `compileUnchecked()` in the static-analysis soundness test, which is a test tool and not public API.
- The tool's README and the guide's note on how the reports were measured.

## Acceptance criteria

From the [parent](T0038-public-api-completion.md#acceptance-criteria):

- [ ] Public API conformance matches the internal adapter without losing any baseline entries, including model, strict and async coverage (`pnpm conformance --check`).
