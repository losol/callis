# T0038b — Public API: async evaluation, hooks and limits

Part of the [roadmap](../roadmap.md). Phase 1 · wave 7 · size M.

- **Depends on:** [T0017](T0017-fn-tree-utility.md), [T0021](T0021-hooks-async.md), [T0025](T0025-public-api-release.md), [T0042](T0042-fn-projection-completion.md)
- **Area:** `area:core`
- **Tier hint:** `risk:high`: new public functions, options and hook types, and a new limit on evaluation, so the core tier with a second reviewer from the other vendor.
- **Parallel with:** [T0038a](T0038a-public-model-options.md), [T0038c](T0038c-public-parser-cache.md), [T0038d](T0038d-public-typed-output.md)
- **Parent:** [T0038](T0038-public-api-completion.md), split on 2026-11-12.

## Goal

Host-backed, cancellable and bounded evaluation through the public API: `evaluateAsync()`, the host hooks of [T0021](T0021-hooks-async.md), a fixed clock and limits on the work of one evaluation, as in the [T0038 sketch](T0038-public-api-completion.md#public-api-sketch).

## Scope

- `evaluateAsync()` and `CompiledExpression.evaluateAsync()`, with the options of `evaluate()`. Compile errors become rejections, like evaluation errors.
- Evaluation options:
  - `hooks`: `resolve`, `terminology`, `conformsTo`, `htmlChecks`, `regex` and `trace`, with their public types (`EvaluationHooks`, `TraceEvent`, the hook contexts and the coded values). A hook that returns a promise in `evaluate()` raises `eval/async-in-sync`.
  - `signal`: any `AbortSignal` (`CancellationSignal`); an aborted signal raises `eval/aborted` with its reason as the cause.
  - `concurrency`: async only.
  - `now`: a `Date` or a function that returns one ([T0017](T0017-fn-tree-utility.md)).
  - `limits`: `EvaluationLimits` with `maxRepeatItems` ([T0042](T0042-fn-projection-completion.md)) and a new `maxCollectionSize`, the most items in any intermediate collection, with a finite default ([architecture: bounded work](../architecture.md#security-and-robustness)). Exceeding it raises `eval/limit-exceeded` in sync and async mode.
- Option validation as for the other options; anything not implemented is rejected.
- Tests in sync and async mode, including hooks that return cross-realm promises and custom thenables ([testing guide](../guides/testing.md#what-to-cover)), type tests, packed consumers, a guide section on async evaluation and hooks, and a `minor` changeset.

## Design notes

- The internal API implements everything except `maxCollectionSize`; the facade validates and passes the options on, as for [T0038a](T0038a-public-model-options.md).
- Choose the `maxCollectionSize` default so the HL7 suites and the documented examples stay far below it, and record the reason in this file. Check the limit where collections grow (navigation, `descendants()`, `repeat()`, `|`, `combine()`), not on every item.
- Typed output from `evaluateAsync()` comes with [T0038d](T0038d-public-typed-output.md); whichever of the two lands second adds the overloads for the other's functions.

## Acceptance criteria

From the [parent](T0038-public-api-completion.md#acceptance-criteria):

- [ ] No future option is accepted as a silent no-op.
- [ ] publint, attw, the zero-dependency check and the size budget all pass.
- [ ] The guide examples for async evaluation and hooks are executed in CI.

And for this child:

- [ ] Every hook-backed function (`resolve()`, `memberOf()`, `subsumes()`, `subsumedBy()`, `conformsTo()`, `htmlChecks()`, `matches()` through `regex`, `trace()`) works through the public API in both modes, and a promise in `evaluate()` raises `eval/async-in-sync`.
- [ ] An aborted signal raises `eval/aborted` before evaluation and before each hook call.
- [ ] A collection beyond `limits.maxCollectionSize`, and a `repeat()` beyond `limits.maxRepeatItems`, raise `eval/limit-exceeded` in both modes, with the defaults and with custom limits.
