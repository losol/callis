# T0038f — Phase-1 documentation and examples

Part of the [roadmap](../roadmap.md). Phase 1 · wave 8 · size M.

- **Depends on:** [T0038a](T0038a-public-model-options.md), [T0038b](T0038b-public-async-hooks-limits.md), [T0038c](T0038c-public-parser-cache.md), [T0038d](T0038d-public-typed-output.md)
- **Area:** `area:core`, `area:docs`, `area:tooling`
- **Tier hint:** the executable documentation tests are in `packages/core/test`, and an API reference generator would add a dependency (`risk:high`), so the core tier.
- **Parallel with:** [T0038e](T0038e-public-conformance-adapter.md)
- **Parent:** [T0038](T0038-public-api-completion.md), split on 2026-11-12.

## Goal

Documentation for the complete phase-1 API as one whole. Each sibling documents what it adds; this task completes the quick start, the guide, the reference decision, the examples and the support documentation, as in the [parent's scope](T0038-public-api-completion.md#scope).

## Scope

- The README quick start, in the root and core READMEs.
- `docs/guide.md`: model-less use, R4, R5 and R6, units, async hooks, errors and output modes, as one guide.
- A generated API reference (TypeDoc), or a recorded decision not to generate one.
- `docs/spec-notes.md` completed, with the conformance reports linked: every phase-1 conformance test passes or is listed with a reason.
- An `examples/` folder with runnable examples (model-less, R4, R5 and R6, async hooks, typed output), executed in CI.
- The release documentation for later 0.x releases, extended in [RELEASING.md](../../RELEASING.md) and `docs/releases/`, reusing the existing workflow and owner process.

## Acceptance criteria

From the [parent](T0038-public-api-completion.md#acceptance-criteria):

- [ ] Every phase-1 conformance test passes, or is listed with a reason in `spec-notes.md`.
- [ ] The README and guide examples are executed in CI.
- [ ] Later 0.x package tarballs install and run in fresh Node and Vite projects; publication remains an owner action.
- [ ] Support, limitations and per-phase conformance documentation describe this release; 1.0 scope and criteria remain open.
