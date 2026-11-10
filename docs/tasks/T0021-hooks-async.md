# T0021 — Host hooks and async evaluation

Part of the [roadmap](../roadmap.md). Phase 1 · wave 6 · size M.

- **Depends on:** [T0020](T0020-fhir-functions.md)
- **Area:** `area:core`
- **Tier hint:** likely `risk:high`: new public API (`evaluateAsync`, `EvaluationHooks`, `TerminologyProvider`), so the core tier with a second reviewer from the other vendor.
- **Parallel with:** –
- **Background:** [ADR-0004](../adr/0004-sync-core-async-path.md)

## Goal

Let hosts plug in I/O-backed behaviour, synchronously or asynchronously ([host hooks](#host-hooks), [ADR-0004](../adr/0004-sync-core-async-path.md)).

## Scope

- `EvaluationHooks` and `TerminologyProvider` types, on the internal API ([public surface](#public-surface)).
- `resolve` falls back to the hook.
- `memberOf`, `subsumes`, `subsumedBy`, `conformsTo` and `htmlChecks` are wired to their hooks. `htmlChecks` forwards both xhtml and string inputs ([owner decision](#owner-decision-htmlchecks-on-strings)).
- A `regex` hook for a safe regex engine.
- `evaluateAsync()` end to end: concurrent hook calls for the items of a collection, with a `concurrency` limit and output order preserved; the `signal` option, typed as the exported structural `CancellationSignal` (any `AbortSignal` fits), stops evaluation with `eval/aborted`.
- **FHIR versions** ([roadmap](../roadmap.md#fhir-versions)): hooks know nothing about FHIR versions. A resource that a `resolve` hook returns is typed by the evaluation's provider through `getRootType()`, like the input. Tests with a model run against the real `r4`, `r5` and `r6` providers, including a hook that returns an R6-only `DeviceAlert`, which is typed under R6 and untyped data under R4 and R5.

## Design notes

### Host hooks

The contracts are in `packages/core/src/runtime/hooks.ts`, where the FHIR functions and the compiler can import them; `api/compile.ts` validates the `hooks` option and binds it to an evaluation, and `fhir/hooks.ts` builds what the FHIR functions pass. The implemented shape:

```ts
type HookResult<T> = T | PromiseLike<T>;

interface HookContext { readonly signal: CancellationSignal | undefined; }
interface ResolveContext extends HookContext { readonly resource: unknown; }   // the JSON of the resource around the reference
interface HtmlChecksContext extends HookContext { readonly kind: 'xhtml' | 'string'; }

interface EvaluationHooks {
  /** Reference.reference / canonical / uri → resource JSON (or undefined), typed by the model like the input. */
  resolve?(reference: string, context: ResolveContext): HookResult<unknown>;
  /** Backs memberOf(), subsumes(), subsumedBy(); later %terminologies (T0032). */
  readonly terminology?: TerminologyProvider;
  /** Backs conformsTo(), with the JSON of the single input item. */
  conformsTo?(value: unknown, profile: string, context: HookContext): HookResult<boolean | undefined>;
  /** Backs htmlChecks(); `context.kind` says whether the text is the xhtml element or the content of a div. */
  htmlChecks?(html: string, context: HtmlChecksContext): HookResult<boolean | undefined>;
  /** Compiles the patterns of matches() and replaceMatches(): a safe engine instead of RegExp. Synchronous. */
  regex?(pattern: string, flags: string): RegexMatcher;
  /** Receives trace() output; awaited in evaluateAsync(), eval/async-in-sync in evaluate() (#185). */
  trace?(event: TraceEvent): void | PromiseLike<void>;
}

interface TerminologyProvider {
  memberOf?(coded: CodedValue, valueSet: string, context: HookContext): HookResult<boolean | undefined>;
  subsumes?(a: Coding, b: Coding, context: HookContext): HookResult<SubsumptionOutcome | undefined>;
}

interface Coding { readonly system?: string; readonly version?: string; readonly code?: string; readonly display?: string; }
interface CodedValue { readonly kind: 'code' | 'Coding' | 'CodeableConcept'; readonly codings: readonly Coding[]; readonly value: unknown; }
type SubsumptionOutcome = 'equivalent' | 'subsumes' | 'subsumed-by' | 'not-subsumed';
interface RegexMatcher { test(text: string): boolean; matchAll(text: string): Iterable<RegExpMatchArray>; }
```

Where this differs from the first sketch: every hook gets a context with the evaluation's `signal`; `subsumes` takes the two codings instead of one system and two codes, so a provider can decide about codings of different systems, which the spec leaves to it, and the shape matches the FHIR `$subsumes` operation; the terminology members are optional, so T0032 can add the `%terminologies` operations next to them; `trace` may return a promise ([#185](https://github.com/losol/callis/issues/185)); and there is a `regex` hook for a safe engine ([architecture: security and robustness](../architecture.md#security-and-robustness)).

`resolve()` first tries what it can do locally, then falls back to the hook:

- contained references (`#id`) against the reference's own root resource; these never go to the hook, because a contained resource is in the data or nowhere
- references inside a `Bundle`, matched on `fullUrl` or on `type/id`

Without a matching hook, the hook-backed functions return empty and never throw. `memberOf()`, `conformsTo()` and `htmlChecks()` take one input item and `subsumes()` and `subsumedBy()` one item on each side, as the R5 text says; anything else gives empty without a hook call. Two codings with the same system and code are equivalent without a provider call.

### Hook answers: empty or an error

The R4 text raises an error where a value set, a profile or the relationship of two code systems cannot be resolved; the R5 and R6 texts give empty instead, and both suites expect an execution error from `testConformsTo3`, `conformsTo('http://trash')` ([#64](https://github.com/losol/callis/issues/64)). The hook decides: `undefined` (or `null`) is "cannot tell" and makes the function empty, as R5 says; an error the hook throws, or a rejection, ends the evaluation unchanged, so a host raises the R4 error by throwing, and throws a `FhirPathEvaluationError` when it wants a stable code. The conformance runner's fake `conformsTo` hook throws `eval/invalid-argument` for a profile that is not a base profile of the suite model, which makes `testConformsTo3` pass without a suite exception ([spec notes](../spec-notes.md#hook-backed-functions-errors-and-empty-results)). A hook answer of another type raises `eval/invalid-argument`.

### Public surface

`packages/core/src/index.ts` is unchanged: [T0025](T0025-public-api-release.md#public-api-sketch) defers `evaluateAsync`, the `hooks` option and the related types from the public facade to [T0038](T0038-public-api-completion.md), and the public type tests reject `hooks` as an option. The hooks and async evaluation live on the internal `api/compile.ts`, which the conformance runner uses, and reach the public API with T0038, which exports `EvaluationHooks`, `TerminologyProvider`, `CancellationSignal` and the other contracts from `runtime/hooks.ts` and `runtime/cancellation.ts`.

### Sync and async

**Decision ([ADR-0004](../adr/0004-sync-core-async-path.md)):** there is one closure tree, and each closure returns `MaybePromise<Collection>`.

- **Promises are detected structurally.** An `isThenable(value)` helper checks for an object or function with a callable `then` property. `instanceof Promise` is not used, because it misses promises from another realm (iframes, `node:vm`) and custom thenables from older promise libraries.
- `evaluate()` is **synchronous**. Every hook must return synchronously. If a hook returns a thenable during a sync evaluation, `eval/async-in-sync` is raised. Promises therefore never appear in sync mode, and the compiler's `then()` helper costs one cheap property check per node.
- `evaluateAsync()` returns a `Promise` and lets hooks return any thenable. Only the parts of an expression that actually reach an async hook pay for it.
- **Two boundaries apply this rule:** host hooks, and user-defined functions added with `registry.extend()`. A thenable result is rejected with `eval/async-in-sync` in sync mode, and adopted with `Promise.resolve()` in async mode, so internal code only ever sees native promises.
- **Tests** cover a cross-realm promise and a custom thenable, in both sync mode (rejected) and async mode (chained correctly).
- **How function implementations handle this:**
  - *Value functions* (most of them) are plain sync functions. The compiler evaluates their arguments and awaits them if needed.
  - *Lambda functions* (`where`, `select`, …) use helpers that stay synchronous until a promise appears.
  - *Host functions* (`resolve`, `memberOf`, …) may return `MaybePromise`.
- Independent async calls for the items of one collection, such as `entry.resource.subject.resolve()`, are started concurrently (with a `concurrency` option, 8 by default, `Infinity` for no limit) and the output order is kept: `mapConcurrent()` in `runtime/maybe-promise.ts`. Lambda functions still evaluate their items one after another (`mapSequential()`), so `trace()` output and other side effects stay in input order.
- **Cancellation:** the `signal` option is read when the evaluation starts, before each hook call, and after each host result the evaluation waited for (`adoptResult()` with the signal, which the compiler also applies to functions added with `registry.extend()`). An abort raises `eval/aborted`, with the signal's `reason` as the error's `cause`. JavaScript runs the evaluation's own code without interruption, so a signal can only change while the evaluation waits for a host, and those three places catch every abort at the next step; a check inside a synchronous loop (`descendants()`, lambda iteration) would never see anything new, so there is none. `repeat()` ([T0042](T0042-fn-projection-completion.md)) can still call `throwIfAborted(call.ctx.signal)` from `runtime/cancellation.ts` in its loop, which is cheap; its bound is `limits.maxRepeatItems`. The signal is typed as a minimal structural interface, `CancellationSignal`, which `@callis/core` exports from T0038 on. That keeps the core free of host typings, and any `AbortSignal` satisfies it:

  ```ts
  /** Structural subset of AbortSignal; any AbortSignal satisfies it. */
  export interface CancellationSignal {
    readonly aborted: boolean;
    readonly reason?: unknown;
  }
  ```

  Hooks receive the same object in their context, so hosts can pass their own `AbortSignal` on to `fetch()`.

### Owner decision: `htmlChecks()` on strings

The R4 and R5 spec texts define `htmlChecks()` on xhtml only ([R4](https://hl7.org/fhir/R4/fhirpath.html#functions), [R5 §2.1.9.1.5](https://hl7.org/fhir/R5/fhirpath.html#fn-htmlChecks)). The R6 draft also accepts a string, parsed as the content of a `div` ([6.0.0-snapshot1 §2.1.9.3.12](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#fn-htmlChecks)), and the pinned R5 suite already expects that: in `HTMLChecks`, `htmlTest02` and `htmlTest03` call it on a `valueString` and expect true and false, and `htmlTest04` expects empty for an integer.

**Decided by the owner (2026-11-08):** `htmlChecks()` accepts strings for every provider (R4, R5 and R6). A string is forwarded to the `htmlChecks` hook like xhtml; any other input gives empty. There are no suite exceptions, and [ADR-0001](../adr/0001-spec-baseline.md) and [ADR-0011](../adr/0011-conformance-suite.md) make the suite the arbiter ([spec notes](../spec-notes.md#htmlchecks-on-strings)). The hook gets the text in both cases; the task decides how it learns which kind it received, because xhtml is the `div` itself and a string is its content, without breaking the hook signature.

**How the hook learns the kind:** the second parameter, the context every hook gets, carries `kind: 'xhtml' | 'string'`: `xhtml` for a node the model types as `xhtml`, `string` for any other string, including an untyped `text.div` evaluated without a model. The text itself is passed as it is, so the first parameter of the sketch is unchanged.

## Acceptance criteria

- [x] A hook or a user-defined function (added with `registry.extend()`) that returns a cross-realm promise (created in a `node:vm` context) or a custom thenable is rejected with `eval/async-in-sync` in `evaluate()`, and is chained correctly in `evaluateAsync()` (`packages/core/test/async.test.ts`, every hook).
- [x] With an async `resolve` hook, `Bundle.entry.resource.subject.resolve().name` returns results in input order and respects `concurrency`.
- [x] The same expression with a sync hook works through `evaluate()`. An async hook in `evaluate()` raises `eval/async-in-sync`.
- [x] An aborted signal stops evaluation with `eval/aborted`: before anything runs, at the next hook call, and after an awaited hook or user-defined function.
- [x] Conformance groups `testConformsTo` (R4 and R5) and `HTMLChecks` (R5 suite only, including the string cases `htmlTest02` and `htmlTest03`) pass, using fake hooks in the runner (`tools/conformance/src/fake-hooks.ts`), with no suite exceptions. Two tests of `HTMLChecks` stay out for reasons of their own: `htmlTest01`, `text.div.htmlChecks()`, does not parse, because `div` is a reserved word ([spec notes](../spec-notes.md#reserved-div-in-an-html-fixture)), and `htmlTest04` needs `empty()` ([T0041](T0041-fn-existence-completion.md)).
- [x] `htmlChecks()` forwards xhtml and strings to the hook under the real `r4`, `r5` and `r6` providers, which covers the R6 draft behaviour; any other input gives empty without calling the hook ([owner decision](#owner-decision-htmlchecks-on-strings)). `docs/spec-notes.md` records the spec/suite disagreement.
- [x] `memberOf()`, `subsumes()` and `subsumedBy()` have unit tests with fake terminology hooks, in sync and async mode (`packages/core/src/fhir/functions.test.ts`), and run against the real providers in `test/generated-models.test.ts`. The suites have no tests for them: `TerminologyTests` holds only `%terminologies` cases, which are [T0032](T0032-fhir-phase2.md) ([#63](https://github.com/losol/callis/issues/63)).
- [x] A `resolve` hook result is typed by the real `r4`, `r5` and `r6` providers in the same way: a `DeviceAlert` the hook returns is a `DeviceAlert` under R6 and untyped data under R4 and R5. No R6 conformance result is claimed.
