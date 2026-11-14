# T0038d — Public API: typed output

Part of the [roadmap](../roadmap.md). Phase 1 · wave 7 · size M.

- **Depends on:** [T0018](T0018-model-aware-evaluation.md), [T0025](T0025-public-api-release.md)
- **Area:** `area:core`
- **Tier hint:** `risk:high`: overloads of the public functions and new public value types, so the core tier with a second reviewer from the other vendor.
- **Parallel with:** [T0038a](T0038a-public-model-options.md), [T0038b](T0038b-public-async-hooks-limits.md), [T0038c](T0038c-public-parser-cache.md)
- **Parent:** [T0038](T0038-public-api-completion.md), split on 2026-11-12.

## Goal

Results without loss: the `output: 'typed'` mode of the [T0038 output modes](T0038-public-api-completion.md#public-api-sketch), and plain output completed against [ADR-0012](../adr/0012-evaluation-defaults.md).

## Scope

- The `output` evaluation option, `'plain'` (the default) or `'typed'`, with overloads on `evaluate()` and `CompiledExpression.evaluate()` that return `FhirPathValue[]` for `'typed'`.
- Public typed values: Boolean, String and Integer as primitives, `Decimal`, the Date, DateTime and Time values, `Quantity`, and a public node type for input and model values that gives the underlying JSON and its model type, without the internal navigation state of `ModelNode`.
- Plain output checked against every rule of the parent's output modes, with tests for each.
- Tests, type tests for the overloads, packed consumers, a guide section on output modes, and a `minor` changeset.

## Design notes

- Decide whether `decimalOutput` with `output: 'typed'` is an invalid combination or ignored, and document it; today the internal API ignores it.
- Expose classes only where callers need `instanceof` or methods (`Decimal` already is public); prefer types for the rest, so later tasks can change the implementation.
- Typed output from `evaluateAsync()` depends on [T0038b](T0038b-public-async-hooks-limits.md); whichever of the two lands second adds the overloads for the other's functions.

## Acceptance criteria

From the [parent](T0038-public-api-completion.md#acceptance-criteria):

- [ ] No future option is accepted as a silent no-op.
- [ ] publint, attw, the zero-dependency check and the size budget all pass.
- [ ] The guide examples for output modes are executed in CI.

And for this child:

- [ ] `output: 'typed'` returns exact Decimal, date/time and Quantity values and typed nodes, and the type tests show the overloads' return types.
- [ ] Plain output follows ADR-0012 in every case the parent lists, and no internal class leaks through it.
