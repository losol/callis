# T0021 — Host hooks and async evaluation

Part of the [roadmap](../roadmap.md). Phase 1 · wave 6 · size M.

- **Depends on:** [T0020](T0020-fhir-functions.md)
- **Parallel with:** –
- **Background:** [ADR-0004](../adr/0004-sync-core-async-path.md)

## Goal

Let hosts plug in I/O-backed behaviour, synchronously or asynchronously ([host hooks](#host-hooks), [ADR-0004](../adr/0004-sync-core-async-path.md)).

## Scope

- `EvaluationHooks` and `TerminologyProvider` types.
- `resolve` falls back to the hook.
- `memberOf`, `subsumes`, `subsumedBy`, `conformsTo` and `htmlChecks` are wired to their hooks.
- A `regex` hook for a safe regex engine.
- `evaluateAsync()` end to end: concurrent hook calls for the items of a collection, with a `concurrency` limit and output order preserved; the `signal` option, typed as the exported structural `CancellationSignal` (any `AbortSignal` fits), stops evaluation with `eval/aborted`.
- **FHIR versions** ([roadmap](../roadmap.md#fhir-versions)): hooks know nothing about FHIR versions. A resource that a `resolve` hook returns is typed by the evaluation's provider through `getRootType()`, like the input. Tests with a model run against the real `r4`, `r5` and `r6` providers, including a hook that returns an R6-only `DeviceAlert`, which is typed under R6 and untyped data under R4 and R5.

## Design notes

### Host hooks

```ts
interface EvaluationHooks {
  /** Reference.reference / canonical / uri → resource JSON (or undefined). */
  resolve?(reference: string, context: ResolveContext): MaybePromise<unknown>;
  /** Backs memberOf(), subsumes(), subsumedBy(); later %terminologies. */
  terminology?: TerminologyProvider;
  /** Backs conformsTo(). */
  conformsTo?(resource: unknown, profileUrl: string): MaybePromise<boolean | undefined>;
  /** Backs htmlChecks(). */
  htmlChecks?(xhtml: string): MaybePromise<boolean | undefined>;
  /** Receives trace() output; the default is a no-op. */
  trace?(event: { name: string; values: readonly unknown[]; span: SourceSpan }): void;
}

interface TerminologyProvider {
  memberOf(coded: CodedValue, valueSetUrl: string): MaybePromise<boolean | undefined>;
  subsumes(system: string, a: string, b: string): MaybePromise<'equivalent' | 'subsumes' | 'subsumed-by' | 'not-subsumed' | undefined>;
}
```

`resolve()` first tries what it can do locally, then falls back to the hook:

- contained references (`#id`) against `%rootResource`
- references inside a `Bundle`, matched on `fullUrl` or on `type/id`

Without a matching hook, the hook-backed functions return empty and never throw.

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
- Independent async calls for the items of one collection, such as `entry.resource.subject.resolve()`, are started concurrently (with a `concurrency` option) and the output order is kept.
- **Cancellation:** in async mode, the `signal` option is checked before each hook call and inside loops (`repeat`, `descendants`, lambda iteration). It is typed as a minimal structural interface, `CancellationSignal`, which `@callis/core` exports. That keeps the core free of host typings, and any `AbortSignal` satisfies it:

  ```ts
  /** Structural subset of AbortSignal; any AbortSignal satisfies it. */
  export interface CancellationSignal {
    readonly aborted: boolean;
    readonly reason?: unknown;
  }
  ```

  Hooks receive the same object in their context, so hosts can pass their own `AbortSignal` on to `fetch()`.

### Open question for the owner

The R6 draft lets `htmlChecks()` run on a string as well as on xhtml: the string is parsed as the content of a `div` ([6.0.0-snapshot1 §2.1.9.3.12](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#fn-htmlChecks)). R4 and R5 define it for xhtml only and give empty for anything else ([R5 §2.1.9.1.5](https://hl7.org/fhir/R5/fhirpath.html#fn-htmlChecks)). Either the hook receives strings for every version, which differs from R4/R5, or only xhtml reaches it, which leaves the R6 behaviour as a known gap. The engine has no version-specific cases, so this needs an owner decision before the task implements `htmlChecks()`; record the outcome in `docs/spec-notes.md`.

## Acceptance criteria

- [ ] A hook or a user-defined function (added with `registry.extend()`) that returns a cross-realm promise (created in a `node:vm` context) or a custom thenable is rejected with `eval/async-in-sync` in `evaluate()`, and is chained correctly in `evaluateAsync()`.
- [ ] With an async `resolve` hook, `Bundle.entry.resource.subject.resolve().name` returns results in input order and respects `concurrency`.
- [ ] The same expression with a sync hook works through `evaluate()`. An async hook in `evaluate()` raises `eval/async-in-sync`.
- [ ] An aborted signal stops evaluation with `eval/aborted`.
- [ ] Conformance groups `testConformsTo` (R4 and R5) and `HTMLChecks` (R5 suite only) pass, using fake hooks in the runner.
- [ ] `memberOf()`, `subsumes()` and `subsumedBy()` have unit tests with fake terminology hooks, in sync and async mode. The suites have no tests for them: `TerminologyTests` holds only `%terminologies` cases, which are [T0032](T0032-fhir-phase2.md) ([#63](https://github.com/losol/callis/issues/63)).
- [ ] A `resolve` hook result is typed by the real `r4`, `r5` and `r6` providers in the same way. No R6 conformance result is claimed.
