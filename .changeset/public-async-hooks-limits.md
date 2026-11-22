---
'@callis/core': minor
---

Add asynchronous evaluation, host hooks, cancellation, a fixed clock and limits to the public API. `evaluateAsync()` and `CompiledExpression.evaluateAsync()` take the options of `evaluate()` and return a promise; every error rejects it, a syntax error or an invalid option too. The new evaluation options:

- `hooks`: host functions for `resolve()` (a reference that is not in the data), `memberOf()`, `subsumes()` and `subsumedBy()` (`terminology`), `conformsTo()`, `htmlChecks()`, a safe engine for `matches()` and `replaceMatches()` (`regex`), and the output of `trace()`. In `evaluateAsync()` a hook may answer with a promise or any other thenable, also from another realm; in `evaluate()` that raises `eval/async-in-sync`. Without its hook a function gives empty, as before. A name in `hooks` that is not a hook raises `eval/invalid-argument`.
- `signal`: any `AbortSignal`; an aborted one raises `eval/aborted`, with its reason as the cause, before the evaluation and before each hook call. Hooks get it in their context.
- `concurrency`: the most hook calls `evaluateAsync()` starts at once for the items of one collection, 8 by default.
- `now`: a `Date` or a function that returns one, for `now()`, `today()` and `timeOfDay()`.
- `limits`: `maxRepeatItems` (5,000 by default) and the new `maxCollectionSize`, the most items of any collection an evaluation builds (1,000,000 by default), checked as the items are made by a navigation step, `children()`, `descendants()`, `repeat()`, `select()`, `trace()`, `resolve()`, `|`, `union()`, `combine()` and `toChars()`. Beyond either, evaluation raises `eval/limit-exceeded`. This also ends `descendants()` on a JavaScript object graph with a cycle, which used to run until memory ran out (#186).

Behaviour change: an evaluation that builds a collection of more than 1,000,000 items now raises `eval/limit-exceeded`; set `limits.maxCollectionSize` for larger data. The hook contracts are exported as types: `EvaluationHooks`, `TerminologyProvider`, `HookContext`, `ResolveContext`, `HtmlChecksContext`, `HookResult`, `Coding`, `CodedValue`, `SubsumptionOutcome`, `RegexMatcher`, `TraceEvent`, `CancellationSignal` and `EvaluationLimits`. `evaluate()`, `compile()` and `analyze()` are otherwise unchanged.
