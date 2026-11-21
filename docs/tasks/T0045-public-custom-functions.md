# T0045 — Public custom-function contract

Part of the [roadmap](../roadmap.md). Phase 3 · wave 9 · size M.

- **Depends on:** [T0026](T0026-stu-aggregates.md), [T0027](T0027-stu-collections.md), [T0028](T0028-stu-long.md), [T0029](T0029-stu-strings.md), [T0030](T0030-stu-precision-datetime.md), [T0031](T0031-stu-reflection.md), [T0032](T0032-fhir-phase2.md), [T0038](T0038-public-api-completion.md)
- **Area:** `area:core`, `area:functions`
- **Tier hint:** likely `risk:high`: new public API that must last, so the core tier with a second reviewer from the other vendor.
- **Background:** [#222](https://github.com/losol/callis/issues/222), [T0008](T0008-compiler-evaluator.md#function-library) (the internal function library), [T0021](T0021-hooks-async.md#host-hooks) (host hooks), [ADR-0004](../adr/0004-sync-core-async-path.md), [ADR-0012](../adr/0012-evaluation-defaults.md)

## Goal

Let a host add its own functions to Callis, through a small public contract that stays stable. The contract is designed before 1.0, so that shipping it is an addition in a 1.x release and breaks nobody.

The contract is not the internal function definition made public. Hosts describe a function with plain public values; Callis turns that description into its internal definition. The internal contract can keep changing without touching the public one.

## Scope

- **Design** the public contract: how a function is declared, how a host gives declarations to the engine, what a function receives and returns, and how it fails. The design is written in this file (or in an ADR, if the owner wants the decision recorded there) and approved by the owner before the implementation merges.
- **Public API** in `@callis/core`: the types, and a factory in the style of `defineFunction({ name, params, returns, evaluate })`. Whether the declarations go in a compile option or in a separate call is part of the design.
- **Adapter:** the one place that knows both the public declaration and the internal `FunctionDefinition`. It checks the declaration and builds the internal definition. No internal type appears in the public API.
- **Behaviour:** compile-time checks of name and arity, like the built-in functions; synchronous and asynchronous evaluation; stable errors.
- **Static analysis:** a declaration may give the analyzer what it can use (such as a result type), with plain public type names and optional members.
- Public tests, type tests, the packed-consumer checks, a guide section with examples that run in CI, and a minor changeset.
- Not in scope: a public `FunctionRegistry` or `createRegistry()`, changes to the [T0021](T0021-hooks-async.md#host-hooks) hooks, and any change to the built-in functions.

If the design and the implementation turn out too big for one PR, split the task as [CONTRIBUTING](../../CONTRIBUTING.md#pull-requests) asks, with the design first.

## Design notes

### Owner decision: the functions option

**Decided by the owner (2026-11-21, [#222](https://github.com/losol/callis/issues/222)):** the `functions` compile option, a custom function registry, does not become public in [T0038](T0038-public-api-completion.md), nor before phase 2 ([T0026](T0026-stu-aggregates.md)–[T0032](T0032-fhir-phase2.md)) has settled the function contract. The public API keeps rejecting it with `eval/invalid-argument`, as it does today, so nothing is silently ignored. Hosts that need to extend the engine use the [T0021](T0021-hooks-async.md#host-hooks) hooks. This task designs the small, stable contract that comes before 1.0.

Why not now: the internal contract is large and still changing. A registry would publish `FunctionRegistry` and `createRegistry()` (`packages/core/src/functions/registry.ts`), and `FunctionDefinition`, `defineFunction()`, `ParamSpec`, `TypeExpectation`, `CallContext`, `LambdaArg`, `TypeArg` and the `Collection` and `Item` values (`packages/core/src/functions/define.ts`). Static analysis reads the same definitions (`input`, `expects`, `scope`), and the phase-2 tasks keep extending them. Every later change would be a breaking change ([API changes](../../CONTRIBUTING.md#api-changes)).

### Design constraints

These are fixed; the design works inside them.

- **Small and stable.** Few concepts. Options objects, optional members and extensible unions instead of positional parameters and closed shapes, so later additions do not break it ([Public API](../../AGENTS.md#public-api)).
- **Plain public values in and out.** A function receives and returns the values of the plain output mode ([ADR-0012](../adr/0012-evaluation-defaults.md)), not `Collection`, `Item`, `CallContext`, `LambdaArg`, `TypeArg`, `ParamSpec`, `TypeExpectation` or `ModelNode`.
- **Nothing internal is exported.** The contract does not expose `FunctionRegistry`, `createRegistry()` or the internal `defineFunction()`. A type test fails if an internal type leaks.
- **Purely additive.** Adding it changes no existing export, option or behaviour. Until it ships, `functions` stays rejected with `eval/invalid-argument`.
- **Same rules as the engine.** No `eval` or `new Function`, own-property access only, and synchronous and asynchronous evaluation as in [ADR-0004](../adr/0004-sync-core-async-path.md).

### Questions the design settles

These are starting points, not decisions.

- **How declarations reach the engine.** A compile option, which may reuse the key `functions` with a new value type (a key that is rejected today can become valid without breaking anyone), or a separate API. Declarations belong to one compile call; there is no global registry.
- **Parameters.** Value parameters first. Whether lambda and type-specifier parameters ever become public, and how the contract leaves room for them.
- **Names.** What a valid name is, and what happens when it equals a built-in or FHIR function: rejected, or an explicit override. A duplicate name.
- **Values.** How the input collection and the arguments appear as plain values, how an empty collection and a single item differ, and which return values are accepted. A value that cannot be converted raises a stable error.
- **Safety of the input.** A function must not be able to change the evaluated input: copies, frozen values or a documented rule.
- **Async and errors.** A function that returns a promise raises `eval/async-in-sync` in `evaluate()` and is awaited in `evaluateAsync()`, as for hooks. A `FhirPathEvaluationError` that a function throws keeps its code, as for hooks ([T0021](T0021-hooks-async.md)).
- **Analysis.** What a declaration may say about its parameters and result, and the default when it says nothing.

## Acceptance criteria

- [ ] The owner has approved the design before the implementation merges.
- [ ] A host adds a function with `name`, `params`, `returns` and `evaluate`, and an expression calls it, in `compile`, `evaluate`, `evaluateAsync` and `analyze`. A call with the wrong name or arity fails at compile time with a stable error.
- [ ] Plain values go in and out for Boolean, String, Integer, Decimal, Date, DateTime, Time, Quantity and JSON objects, with tests for empty, single and many items. No internal value reaches the host function, and the function cannot change the input.
- [ ] A type test fails when `Collection`, `Item`, `CallContext`, `LambdaArg`, `TypeArg`, `ParamSpec`, `TypeExpectation`, `FunctionRegistry` or `ModelNode` is reachable from the public exports, and the packed-consumer check of the public exports (`scripts/check-public-api.ts`, part of `pnpm check:packages`) lists the new exports.
- [ ] Both promise cases behave as the design notes say, including a cross-realm promise and a custom thenable; a throwing function keeps its error code.
- [ ] Phase-2 and later built-in functions and changes to the internal `FunctionDefinition` need no change to the public contract; only the adapter changes.
- [ ] The `functions` rejection is unchanged until this task ships, then replaced by the documented behaviour. The T0021 hooks and every existing export, option and test are unchanged; the conformance baseline does not go down.
- [ ] The guide documents the contract with examples that run in CI. The package README and the architecture overview say what hosts can extend and how.
- [ ] A minor changeset. No release is selected for this task ([Release scope and tracking](../../CONTRIBUTING.md#release-scope-and-tracking)); the owner chooses the milestone, and publishing remains an owner action.
