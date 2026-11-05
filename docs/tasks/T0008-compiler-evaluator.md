# T0008 — Compiler and evaluator core

Part of the [roadmap](../roadmap.md). Phase 1 · wave 3 · size L.

- **Depends on:** [T0002](T0002-parser.md), [T0003](T0003-types-and-collections.md), [T0004](T0004-decimal.md), [T0005](T0005-date-time.md), [T0006](T0006-quantity.md)
- **Parallel with:** [T0007](T0007-ucum.md), [T0009](T0009-equality-kernels.md), [T0023](T0023-xml-fixture-conversion.md)
- **Background:** [ADR-0003](../adr/0003-closure-compilation.md), [ADR-0004](../adr/0004-sync-core-async-path.md)

## Goal

Compile an AST into closures and evaluate them over plain JSON ([compiling to closures](#compiling-to-closures), [ADR-0003](../adr/0003-closure-compilation.md), [ADR-0004](../adr/0004-sync-core-async-path.md)).

## Scope

- `src/compiler/`:
  - `compileNode()` for every AST kind
  - literal construction through the T0004/T0005/T0006 value modules. Invalid literal values (out-of-range dates, a timezone on a Time literal, a Decimal literal beyond the Decimal size bound) compile to a closure that raises `eval/invalid-literal` when evaluated, not a compile-time error ([invalid literal values](#invalid-literal-values); tests `testLiteralTimeUTC` and `testLiteralTimeTimezoneOffset`)
  - constant folding of `-<number>`
  - `MaybePromise` helpers (`then`, `all`, the sync guard), built on a structural `isThenable()` (a callable `then` property, never `instanceof Promise`; [T0021: sync and async](T0021-hooks-async.md#sync-and-async))
  - lambda compilation for higher-order parameters
- `src/runtime/`:
  - `EvalContext` and `Frame` (`$this`, `$index`)
  - model-less JSON navigation: array flattening, own-property checks, `ModelNode` creation
  - the root-identifier rule against `resourceType`
  - variables: `%context`, `%ucum`, user variables, and the `eval/undefined-variable` error
- In the compiler, the operators that do not need equality: the indexer `[]`, unary `+`/`-`, `and`/`or`/`xor`/`implies` (three-valued logic, both operands evaluated), and `is`/`as` on System types.
- `src/functions/registry.ts` and `define.ts`:
  - `FunctionDefinition`, `ParamSpec`, `createRegistry()`
  - compile-time lookup with `semantic/unknown-function` and `semantic/wrong-arity`
  - helpers for value, lambda and host functions
  - a handful of test-only functions to exercise the machinery
- `src/api/`: internal `compile()` and `evaluate()`, plus basic `plain`/`typed` output adapters (finished in T0025).
- The conformance runner's evaluator adapter (T0022) is wired to this internal API, replacing the runner's stub.

## Out of scope

Equality-based operators (T0010), model-aware navigation (T0018), real library functions (T0011–T0017).

## Design notes

### Compiling to closures

**Decision ([ADR-0003](../adr/0003-closure-compilation.md)):** `compile()` turns the AST into a tree of JavaScript closures once. Evaluating means calling the root closure.

```ts
type Collection = readonly Item[];
type Evaluator = (ctx: EvalContext, focus: Collection, frame: Frame) => MaybePromise<Collection>;

function compileNode(node: ExpressionNode, cc: CompileContext): Evaluator {
  switch (node.kind) {
    case 'Member': {
      const target = compileNode(node.target, cc);
      const name = node.name; // resolved once
      return (ctx, focus, frame) => then(target(ctx, focus, frame), (input) => navigate(ctx, input, name));
    }
    case 'FunctionCall': {
      const fn = cc.registry.resolve(node.name, node.args.length, node.span); // lookup and arity check once
      // ...
    }
    // ...
  }
}
```

- **Done once, at compile time:** function lookup and arity check; choosing the operator implementation; building literal values (`Decimal`, dates, quantities); resolving type specifiers against the model; folding side-effect-free constant subtrees (for example `-1` or `'a' & 'b'`).
- **`EvalContext`** is created per evaluation. It holds the input (`%context`), `%resource`, `%rootResource`, variables, model, unit system, hooks, a snapshot of `now`, the timezone policy, the output mode, the evaluation limits, and a cancellation signal ([T0021: sync and async](T0021-hooks-async.md#sync-and-async)).
- **`Frame`** holds the iteration variables `$this`, `$index` and `$total`. Frames are passed as parameters and chained for nested lambdas, never stored globally. That keeps a compiled expression reentrant and safe for concurrent async evaluations.
- **Higher-order functions** (`where`, `select`, `all`, `exists(criteria)`, `repeat`, `iif`, and later `aggregate`, `sort`, `defineVariable`) receive their lambda arguments as compiled closures, not as evaluated values. The function definition declares which parameters are lambdas.
- **Errors** carry the span of the node that failed. Spans are attached at operator and function-call boundaries, not on every node, to keep the hot path cheap.
- **Generating JavaScript source** (`new Function`) was rejected: it breaks under a Content-Security-Policy without `unsafe-eval` and is harder to debug.

### Invalid literal values

Invalid literal values are well-formed tokens whose value is not allowed: an out-of-range date component (`@2015-02-30`), a timezone on a Time literal (`@T14:34:28Z`), or a Decimal literal beyond the Decimal size bound. The size bound is more than 10,000 significant digits, or more than 10,000 digits after the point; `Decimal.parse()` returns `undefined` for such a literal ([T0004](T0004-decimal.md#design-notes)). These do not fail at compile time. The compiler emits a closure that raises `FhirPathEvaluationError` (`eval/invalid-literal`) when it is evaluated. The suite classifies these as execution errors (`testLiteralTimeUTC` and `testLiteralTimeTimezoneOffset` are `invalid="execution"`), and the error-class checks in [T0022: conformance runner](T0022-conformance-runner.md#design-notes) depend on that. The suite has no test for an oversized Decimal literal; the owner chose the same treatment for it ([#69](https://github.com/losol/callis/issues/69)).

### Function library

```ts
interface FunctionDefinition {
  readonly name: string;
  readonly params: readonly ParamSpec[];  // { kind: 'value' | 'lambda' | 'type', optional?, variadic? }
  readonly returns?: TypeHint;            // for the analyzer
  readonly async?: boolean;               // true if it may call host hooks
  readonly impl: (call: CallContext, input: Collection, args: readonly Arg[]) => MaybePromise<Collection>;
}
```

- The **registry** maps names to definitions. Names are resolved at compile time; an unknown name is a semantic error.
- `createRegistry({ standard: true, fhir: true })` is the default. `registry.extend([...])` adds user-defined functions. Library code builds its maps with `Object.create(null)`.
- The standard library is split into files that mirror the spec sections: `existence`, `filtering`, `subsetting`, `combining`, `conversion`, `string`, `math`, `tree`, `utility`. The FHIR functions live in `src/fhir/`.
- **Operators are not in the registry**, because the grammar fixes them. They share kernels (`equality`, `comparison`, `arithmetic`) with the functions.
- Each function file has a test file next to it containing the examples from its spec section.

## Acceptance criteria

- [ ] End to end: `compile(expr).evaluate(json)` works for navigation, literals of every type, the indexer, `$this`, `$index`, variables, Boolean logic, and `is`/`as` with System types.
- [ ] Each lambda helper is tested in sync mode, and in async mode using a test-only async function. A thenable in sync mode raises `eval/async-in-sync`, including a cross-realm promise and a custom thenable.
- [ ] Navigating to `__proto__`, `constructor` or `toString` returns empty.
- [ ] A compiled expression can be evaluated concurrently (two overlapping async evaluations) without interference.
- [ ] Once fixtures exist (T0023), the individual suite tests that use only T0008 features (navigation, literals, the indexer, `$this`, variables, Boolean logic, `is`/`as` on System types) pass, for example `Patient.name[-1]` and the literal parts of `testLiterals`; the PR lists them. No whole group is expected to pass with T0008 alone, because the groups also use operators and functions:
  - `testIndexer` needs `=` and `|` (completed by T0010)
  - `testCollectionBoolean` needs `iif()` (completed by T0014)
  - `testDollar` needs `where`, `skip`, `substring`, `length`, `children` and a semantic check (completed by T0013, with T0012, T0015, T0017 and T0024)
