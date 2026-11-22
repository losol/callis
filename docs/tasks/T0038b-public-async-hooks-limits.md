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

### Where the limit is checked

`limits.maxCollectionSize` is checked where a collection grows beyond the size of what it is built from, never in a pass over the items: after each input item of a navigation step (`navigateMember()`, `navigateRoot()`, `navigateChildren()`, so also `children()`), after each item `descendants()` adds, after each new item of `repeat()`, after each item's results in `select()`, in the projection of `trace()` and in `resolve()`, after each item `|` and `union()` add, and before `combine()` builds its result. Every other operation gives at most as many items as its input. A collection can so pass the limit by at most what one input item adds, such as the elements of one JSON array. The input and the variables are the host's data and are not counted. The check in navigation is the one that bounds host object graphs that share or repeat objects: `descendants()` on a cycle ([#186](https://github.com/losol/callis/issues/186)), and paths such as `next.next.next…` on an object whose `next` lists itself several times, which multiply the items at every step. Detecting cycles by object identity would miss the second. The error gets the span of the step that raised it; navigation steps attach theirs like operators and functions do.

### The `maxCollectionSize` default

**1,000,000 items**, chosen on 2026-11-22 from these measurements (Node 24 on a laptop):

- **The HL7 suites stay far below it.** Every R4 and R5 suite test still passes with a limit of 100, and some fail at 30, so the largest collection any suite test builds has at most 100 items: four orders of magnitude below the default. The largest vendored fixture, the IPS document `bundle-document-ips.json`, has 300 descendants. The README and guide examples build at most four items, and all fail to load at a limit of 3.
- **Real data fits.** The vendored HL7 examples average about 21,000 nodes per MB of JSON, so `descendants()` of one document reaches a million items at about 50 MB, beyond what one evaluation of a single resource or Bundle usually holds in memory. A host with larger data raises the limit.
- **A runaway stops quickly and fits in memory.** `descendants()` on a cyclic object graph stops at the default after about 0.2 s and 220 MB of heap. Ten million would take about 1.6 s and 2.4 GB, more than a browser tab or a default Node.js heap can count on, so the limit would no longer prevent the out-of-memory crash it exists for.

The limit bounds memory, not time: `|`, `union()`, `intersect()`, `exclude()` and `distinct()` compare every pair of items, so they take seconds already for tens of thousands of items ([#190](https://github.com/losol/callis/issues/190)).

### Public API decisions

- `hooks` is an options object: an own property that is not a hook is rejected with `eval/invalid-argument`, as for `lenient`, so a misspelled hook, or a future one such as a warning hook for [#232](https://github.com/losol/callis/issues/232), is never silently ignored. The object is passed on as it is, so the hooks are called with it as `this` and may be methods of a class whose state is in private (`#`) fields. `terminology` is a provider object like `units` and `model`, so a client object with other properties of its own can be passed; only its two members are checked.
- One `EvaluateOptions` serves `evaluate()` and `evaluateAsync()`. `concurrency` is validated in both; `evaluate()` calls one hook at a time, which every value allows. `signal` works in both: in `evaluate()` only a hook can abort it while the evaluation runs.
- `now` takes a `Date` from any realm, checked with `Date.prototype.getTime()` rather than `instanceof`, and copied when the evaluation starts, so a later change to the object cannot reach an evaluation that is waiting for a hook. An invalid `Date` is rejected before evaluation; the result of a function is checked when the evaluation first needs the time.
- `evaluateAsync()` and `CompiledExpression.evaluateAsync()` read their options when they are called and reject for every error, a syntax error or an invalid option too; they never throw.
- The hook contracts are exported as types only (`EvaluationHooks`, `TerminologyProvider`, `HookContext`, `ResolveContext`, `HtmlChecksContext`, `HookResult`, `Coding`, `CodedValue`, `SubsumptionOutcome`, `RegexMatcher`, `TraceEvent`, `CancellationSignal`, `EvaluationLimits`). Every member is optional, so a later hook or limit is an addition.

## Acceptance criteria

From the [parent](T0038-public-api-completion.md#acceptance-criteria):

- [x] No future option is accepted as a silent no-op.
- [x] publint, attw, the zero-dependency check and the size budget all pass.
- [x] The guide examples for async evaluation and hooks are executed in CI.

And for this child:

- [x] Every hook-backed function (`resolve()`, `memberOf()`, `subsumes()`, `subsumedBy()`, `conformsTo()`, `htmlChecks()`, `matches()` through `regex`, `trace()`) works through the public API in both modes, and a promise in `evaluate()` raises `eval/async-in-sync` (`packages/core/test/public-async-hooks.test.ts`).
- [x] An aborted signal raises `eval/aborted` before evaluation and before each hook call.
- [x] A collection beyond `limits.maxCollectionSize`, and a `repeat()` beyond `limits.maxRepeatItems`, raise `eval/limit-exceeded` in both modes, with the defaults and with custom limits; this ends `descendants()` on a cyclic object graph ([#186](https://github.com/losol/callis/issues/186)).
