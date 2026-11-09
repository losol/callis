# T0025 — Minimal synchronous public API

Part of the [roadmap](../roadmap.md). Phase 1 · wave 5 · size M.

- **Depends on:** [T0007](T0007-ucum.md), [T0008](T0008-compiler-evaluator.md), [T0009](T0009-equality-kernels.md), [T0010](T0010-operators.md), [T0023](T0023-xml-fixture-conversion.md)
- **Parallel with:** model-aware evaluation and the remaining function groups; no dependency on their completion
- **Background:** [ADR-0009](../adr/0009-esm-only-zero-deps.md), [ADR-0012](../adr/0012-evaluation-defaults.md)

## Goal

Expose a small, usable synchronous API for the capabilities implemented after wave 3 and T0010. Model-less JSON evaluation, operators, exact output when requested and stable errors are enough for the first playground. This task prepares an API; it does not publish packages.

The original T0025 bundled the entire phase-1 API and the first release. Its remaining API work is preserved in [T0038](T0038-public-api-completion.md); [T0036](T0036-playground.md) owns the playground and [T0037](T0037-first-release-readiness.md) owns first-release preparation. The file path is retained for existing links.

## Scope

- A public facade over the internal T0008 compiler/evaluator. Preserve internal consumers and the existing package exports, including `ModelProvider`, `UnitSystem` and `Decimal`.
- `compile` and `evaluate`, with options objects that can grow additively. Public compilation accepts a string; the compiled object exposes only `expression` and synchronous `evaluate`.
- Model-less JSON input and plain output only. No promise or internal `ModelNode` escapes as a result item. Preserve input immutability and own-property navigation.
- Public option validation, including rejecting unsupported options rather than silently accepting unfinished capabilities. `units` selects an implemented `UnitSystem`; variables and timezone policy reuse implemented behaviour.
- Public error classes, codes, spans and diagnostic types sufficient to catch and display syntax, semantic and evaluation errors without importing internals.
- Public entry-point tests and type tests, package checks, a minor changeset, executable quick-start examples and documentation of exactly which syntax/operators/functions work. The package README and root README must distinguish available source capabilities from released support.
- Keep the conformance adapter on the internal API while it needs options not yet public. Compare public model-less cases with that adapter; T0038 moves the complete adapter to the public API without weakening the baseline.

## Design notes

### Public API sketch

```ts
interface CompileOptions {
  readonly units?: UnitSystem;
}
interface EvaluateOptions {
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly timezoneOffset?: number | 'local';
  readonly decimalOutput?: 'number' | 'string';
}
interface CompiledExpression {
  readonly expression: string;
  evaluate(input: unknown, options?: EvaluateOptions): unknown[];
}
function compile(expression: string, options?: CompileOptions): CompiledExpression;
function evaluate(input: unknown, expression: string, options?: CompileOptions & EvaluateOptions): unknown[];
```

Plain output follows ADR-0012: primitives remain primitives; Decimal defaults to `number`, with exact text through `decimalOutput: 'string'`; temporal values are FHIR strings without `@`; Quantity is a JSON-friendly `{ value, unit, system?, code? }`; input nodes return their underlying JSON. Export the plain Quantity type. Document that JavaScript input numbers may already have lost precision and that exact output does not repair them. The playground can use string Decimal output without serializing internal classes.

Do not expose public `parse`, AST input or the compiled `ast` property until [#107](https://github.com/losol/callis/issues/107) is resolved. They are deferred to T0038. Also defer `analyze`, `evaluateAsync`, typed output, model-aware options, hooks, custom function registries, strict/lenient analysis, future function limits and the LRU cache. Existing exported provider contracts remain public; this task does not claim model-aware evaluation is ready.

Document later features as planned with task links. A parsed expression is not evidence that its operators or functions are implemented. Unsupported functions/operators must fail with stable errors, never plausible empty results. Preserve the future API direction in T0038 without exporting no-op options.

## Acceptance criteria

- [ ] Entry-point imports compile and evaluate synthetic JSON with implemented navigation, literals, variables and T0010 operators; compiled expressions are reusable and evaluations isolated.
- [ ] Plain output and exact Decimal/Quantity string output work; no promise, internal node or AST leaks through the advertised API.
- [ ] Errors can be caught and displayed through public exports; invalid and unsupported options produce stable errors. Type tests reject deferred options and members.
- [ ] Existing public exports and internal compiler/conformance consumers remain compatible.
- [ ] Quick-start examples run in CI; support and limitations are explicit and link to the published [R4](https://callis.losol.no/conformance/r4) and [R5](https://callis.losol.no/conformance/r5) conformance reports without claiming full phase-1 compliance.
- [ ] `pnpm check` and conformance pass without baseline regressions; the baseline and changeset are committed, and the reports are generated, never committed ([#187](https://github.com/losol/callis/pull/187)). No package is published by this task.
