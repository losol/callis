# T0038c — Public API: parser, AST input and compile cache

Part of the [roadmap](../roadmap.md). Phase 1 · wave 7 · size M.

- **Depends on:** [T0024b](T0024b-strict-mode.md), [T0025](T0025-public-api-release.md)
- **Area:** `area:core`
- **Tier hint:** `risk:high`: a public `parse()`, public AST types and a cache in `evaluate()`, so the core tier with a second reviewer from the other vendor.
- **Parallel with:** [T0038a](T0038a-public-model-options.md), [T0038b](T0038b-public-async-hooks-limits.md), [T0038d](T0038d-public-typed-output.md)
- **Parent:** [T0038](T0038-public-api-completion.md), split on 2026-11-12.

## Goal

Expressions as data for tooling, and repeated string evaluation without repeated compilation: `parse()`, AST input, the compiled `ast` property and the bounded compile cache of the [T0038 sketch](T0038-public-api-completion.md#public-api-sketch). The parser counts chains towards its nesting limit since [#201](https://github.com/losol/callis/pull/201), which resolved the [#107](https://github.com/losol/callis/issues/107) prerequisite.

## Scope

- `parse(expression, options?)` with `ParseOptions`, returning the public, immutable AST: `ExpressionNode` and its node types, with spans.
- `analyze()` and `compile()` accept an `ExpressionNode`. A hand-made tree is checked before analysis: known node kinds, own properties only, and the nesting limit (`syntax/nesting-limit`, never a `RangeError`).
- `CompiledExpression.ast`, and `evaluate()` and `evaluateAsync()` with a `CompiledExpression` made by `compile()`.
- The compile cache: `evaluate()` with a string reuses compiled expressions from a bounded LRU cache, keyed by the expression and the identity of its compile options. Its size is configurable, and it can be turned off.
- Tests, including bounded-tree regressions for `parse()` and for hand-made trees, type tests, packed consumers, a guide section on the parser and the cache, and a `minor` changeset.

## Design notes

- The code style forbids mutable module-level state, and a default cache shared by every `evaluate()` call is exactly that. Choose between an explicit cache object passed with an option (for example `createCompileCache({ size })`) and a default cache as a documented exception, and ask the owner before the second.
- Two option objects with the same content are different keys, so a host that builds options per call gets no reuse but never a wrong result. A model, unit system or registry is part of the key by identity.

## Acceptance criteria

From the [parent](T0038-public-api-completion.md#acceptance-criteria):

- [ ] The [#107](https://github.com/losol/callis/issues/107) parser-depth prerequisite is covered: `parse()` raises `syntax/nesting-limit` for long chains and long left-associative operator sequences, and a hand-made tree deeper than the limit is rejected before any recursive walk.
- [ ] No future option is accepted as a silent no-op.
- [ ] publint, attw, the zero-dependency check and the size budget all pass.

And for this child:

- [ ] `compile(parse(expression))` evaluates like `compile(expression)`, and the AST cannot be changed through the public API.
- [ ] The cache never returns an expression compiled with other options, stays within its size, and can be turned off.
