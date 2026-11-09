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
  - literal construction through the T0004/T0005/T0006 value modules. Invalid literal values (out-of-range dates, a timezone on a Time literal, a Decimal literal beyond the Decimal size bound, an Integer literal outside the 32-bit range) compile to a closure that raises `eval/invalid-literal` when evaluated, not a compile-time error ([invalid literal values](#invalid-literal-values); tests `testLiteralTimeUTC` and `testLiteralTimeTimezoneOffset`)
  - constant folding of `-<number>` and `-<quantity>`, so `-2147483648` is a valid Integer; folding gives the same result as evaluation, so further polarity operators overflow to empty as at runtime
  - lambda compilation for higher-order parameters
  - a depth limit on the expression tree (`nesting.ts`), checked without recursion before compiling: the parser builds member, call and left-associative operator chains in a loop, so they can be deeper than its nesting limit, and the recursive compiler and closures would otherwise overflow the stack. Too deep raises `syntax/nesting-limit`.
- `src/runtime/`:
  - `EvalContext` and `Frame` (`$this`, `$index`, `$total`)
  - `MaybePromise` helpers in `maybe-promise.ts`: `andThen`, `mapSequential`, and the sync guard (`adoptResult`, `requireSync`), built on a structural `isThenable()` (a callable `then` property, never `instanceof Promise`; [T0021: sync and async](T0021-hooks-async.md#sync-and-async)). They live in `runtime/`, not `compiler/`, because library functions use them and `functions` imports `runtime` and `values` but never `compiler` ([module rules](../architecture.md#repository-layout)). The helper that chains is not called `then`: a module that exports `then` is a thenable itself, and `import()` of it calls that function instead of returning the module. Arguments and lambda items are evaluated one after another (`mapSequential`), never overlapping, so no promise is left unobserved when one fails; concurrent hook calls are T0021.
  - model-less JSON navigation: array flattening, own-property checks, `ModelNode` creation for every JSON value, objects and primitives alike, so later operations keep its provenance
  - the root-identifier rule against `resourceType`
  - variables: `%context`, `%ucum`, user variables, and the `eval/undefined-variable` error
  - type targets (`type-target.ts`): compile-time resolution, the model-less resource-name matcher, and `is`/`as` on collections, for T0012 to reuse in `ofType()`
  - the shared node conversion `toSystemValue()` (`node-value.ts`), merged ahead of this task in [#98](https://github.com/losol/callis/pull/98) because T0009 needs it too
- In the compiler, the operators that do not need equality: the indexer `[]`, unary `+`/`-`, `and`/`or`/`xor`/`implies` (three-valued logic, both operands evaluated), and `is`/`as` on System types. The other operators compile to a closure that raises the temporary `eval/not-implemented` when evaluated, until T0010 implements them; their operands are still compiled, so unknown functions and wrong arities in them fail at compile time.
- `src/functions/registry.ts` and `define.ts`:
  - `FunctionDefinition`, `ParamSpec`, `createRegistry()`
  - compile-time lookup with `semantic/unknown-function` and `semantic/wrong-arity`; a type argument that is not a type name is `semantic/invalid-argument`
  - helpers for value, lambda and host functions
  - test-only functions to exercise the machinery (`packages/core/test/support/test-functions.ts`)
  - the function forms `is(type)` and `as(type)` (`types.ts`), and `not()` (`logic.ts`) from [N1 §6.5](https://hl7.org/fhirpath/N1/#boolean-logic): it belongs with the Boolean operators, and no other task owns it
- `src/api/`: internal `compile()`, `evaluate()` and `evaluateAsync()`, plus basic `plain`/`typed` output adapters (finished in T0025).
- The conformance runner's `EvaluatorAdapter` is wired to this internal API, replacing the runner's stub in `tools/conformance/src/engine-adapter.ts` ([T0022: adapter interface](T0022-conformance-runner.md#adapter-interface), [runner contract](../../tools/conformance/README.md#plugging-in-an-evaluator)). It reports spec functions, FHIR variables and operators that later tasks add as "not implemented", so a test that expects an error never passes because a feature is missing ([spec notes](../spec-notes.md#features-that-later-tasks-add)). T0025 later switches that entry point to the public API ([#48](https://github.com/losol/callis/issues/48)).

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
      return (ctx, focus, frame) => andThen(target(ctx, focus, frame), (input) => navigate(ctx, input, name));
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

Invalid literal values are well-formed tokens whose value is not allowed: an out-of-range date component (`@2015-02-30`), a timezone on a Time literal (`@T14:34:28Z`), a Decimal literal beyond the Decimal size bound, or an Integer literal outside the 32-bit range ([spec notes](../spec-notes.md#integer-literals-outside-the-32-bit-range)). The size bound is more than 10,000 significant digits, or more than 10,000 digits after the point; `Decimal.parse()` returns `undefined` for such a literal ([T0004](T0004-decimal.md#design-notes)). These do not fail at compile time. The compiler emits a closure that raises `FhirPathEvaluationError` (`eval/invalid-literal`) when it is evaluated. The suite classifies these as execution errors (`testLiteralTimeUTC` and `testLiteralTimeTimezoneOffset` are `invalid="execution"`), and the error-class checks in [T0022: conformance runner](T0022-conformance-runner.md#design-notes) depend on that. The suite has no test for an oversized Decimal literal; the owner chose the same treatment for it ([#69](https://github.com/losol/callis/issues/69)).

### Type names that do not resolve

T0008 owns target resolution and error timing for `is`/`as` (operator and function forms); T0012 reuses the contract for `ofType()`, and T0018 supplies model-aware item types. See [spec notes: unresolved type specifiers](../spec-notes.md#unresolved-type-specifiers-are-execution-errors) ([#58](https://github.com/losol/callis/issues/58)).

- Resolve each type specifier once at compile time with T0003's `resolveTypeSpecifier()`. Keep its pure API unchanged: it returns a type or `undefined`, never inspects input and never throws for an unknown type. Qualified names stay in their namespace; knowing a namespace does not make a nonexistent type valid.
- Compile the outcome as a resolved target, a [model-less resource-name target](#resource-type-names-without-a-model), or an unresolved target. An unresolved target produces a closure that raises `FhirPathEvaluationError` with `eval/unknown-type` and the use-site span when that operator/function is evaluated. Add the evaluation error code in T0008. Neither ordinary compilation nor constant folding raises it early; an unevaluated lazy branch does not raise it. Validate the target before matching items, including when the input is empty.
- With a model supplied, a name absent from both that model and System is an error. `System.Patient`, `FHIR.Boolean` with a FHIR model, `Foo.Patient`, and unqualified `string1` are errors, not false/empty. Without a model, qualified `FHIR.Patient` is also an error; only the unqualified resource-name extension below applies.
- A resolved target whose type does not match is an ordinary mismatch: `is` returns false, `as` returns empty, and `ofType()` discards the item. Existing subtype rules remain; `ofType()` additionally accepts the mapped System type of FHIR primitives ([existing type rules](T0003-types-and-collections.md#type-system)).
- Static analysis may warn with `semantic/unknown-type`, but does not turn this execution failure into a compile failure, including in strict mode ([T0024](T0024-static-analysis.md#design-notes)). The pinned phase-1 `testFHIRPathAsFunction23` and `24` require execution errors. The conflicting positive assertion in `testType22` is handled only by a named suite exception when model-aware execution is wired in T0018, as [spec notes](../spec-notes.md#unresolved-type-specifiers-are-execution-errors) explains; it grants no semantic exemption to `System.Patient` or any other unknown name.

### Resource type names without a model

Model-less JSON evaluation is a Callis extension, separate from resolving System/model types ([#59](https://github.com/losol/callis/issues/59), [spec notes](../spec-notes.md#resource-type-names-without-a-model)). T0008 implements its item matcher for `is`/`as`, and T0012 reuses it for `ofType()`.

- Without a model, an unqualified name first resolves against System. If it does not resolve, compile it as an exact resource-name target. No FHIR type registry, capitalization heuristic or scan of the input's resources is required; `resolveTypeSpecifier({ name: 'Patient' })` still returns `undefined`.
- A resource-name target matches only an input object whose own `resourceType` is a string exactly equal to that name, case-sensitively. Read it with `Object.hasOwn`; inherited properties, missing/non-string values, arrays, null and primitives do not match. A string value `'Patient'` is not a Patient resource.
- Every such unqualified name is a valid resource-name target in this mode, even a misspelling or a name not present in the input. A nonmatch is false for singleton `is` and empty for `as`/`ofType()`, not an unknown-type error. This intentional loss of typo detection is confined to model-less unqualified targets. Qualified unknown names always error.
- There is no inferred inheritance: a Patient does not match `Resource` or `DomainResource`; those names match only literal equal `resourceType` strings. System names take precedence (`String` means `System.String`, even on an object with `resourceType: 'String'`). Ordinary singleton/cardinality rules still apply; for a valid target, empty `is` is false under [3.0.0](https://hl7.org/fhirpath/STU3/en/#is-type-specifier), empty `as`/`ofType()` is empty, and multi-item `is`/`as` raises `eval/singleton-expected`.
- With a model supplied, never fall back to raw `resourceType`, even for an untyped node: the provider and T0018 determine model item types. Do not equate a resource-name target with a `ModelTypeInfo` or change the T0003 System/model subtype helpers. Reuse the own-property exact-name rule for the model-less root identifier so navigation and type tests agree ([T0018 navigation](T0018-model-aware-evaluation.md#navigation-rules)).

### Function library

```ts
interface FunctionDefinition {
  readonly name: string;
  readonly params: readonly ParamSpec[];  // { kind: 'value' | 'lambda' | 'type', optional?, variadic? }
  readonly returns?: TypeHint;            // for the analyzer
  readonly async?: boolean;               // true if it may call host hooks
  // Any thenable: adopted in async mode, `eval/async-in-sync` in sync mode.
  readonly impl: (call: CallContext, input: Collection, args: readonly Arg[]) => Collection | PromiseLike<Collection>;
}
```

- The **registry** maps names to definitions. Names are resolved at compile time; an unknown name is a semantic error.
- `createRegistry({ standard: true, fhir: true })` is the default. `registry.extend([...])` adds user-defined functions. Library code builds its maps with `Object.create(null)`.
- The standard library is split into files that mirror the spec sections: `existence`, `filtering`, `subsetting`, `combining`, `conversion`, `string`, `math`, `tree`, `utility`, plus `types` (`is()`, `as()`) and `logic` (`not()`) for the function forms in the operations sections. The FHIR functions live in `src/fhir/`.
- **Operators are not in the registry**, because the grammar fixes them. They share kernels (`equality`, `comparison`, `arithmetic`) with the functions.
- Each function file has a test file next to it containing the examples from its spec section.

## Acceptance criteria

- [x] End to end: `compile(expr).evaluate(json)` works for navigation, literals of every type, the indexer, `$this`, `$index`, variables, Boolean logic, and `is`/`as` with System types.
- [x] Each lambda helper is tested in sync mode, and in async mode using a test-only async function. A thenable in sync mode raises `eval/async-in-sync`, including a cross-realm promise and a custom thenable.
- [x] Navigating to `__proto__`, `constructor` or `toString` returns empty.
- [x] Unknown qualified targets (`System.Patient`, `Foo.Patient`, and model-less `FHIR.Patient`) compile, then raise `eval/unknown-type` in both `is` and `as` forms, even on empty input; valid System mismatches remain false/empty. A lazy branch that is not evaluated does not raise the error.
- [x] Without a model, on `{"contained": [{"resourceType": "Patient"}, {"resourceType": "Observation"}]}`, `contained[0] is Patient` is true, `contained[1] is Patient` is false, and `contained[1] as Observation` returns that item. Cover `'Patient' is Patient`, a misspelled target, System-name precedence, absent/non-string/inherited `resourceType`, lack of inheritance, and valid-target empty/multiple input rules.
- [x] A compiled expression can be evaluated concurrently (two overlapping async evaluations) without interference.
- [x] Once fixtures exist (T0023), the individual suite tests that use only T0008 features (navigation, literals, the indexer, `$this`, variables, Boolean logic, `is`/`as` on System types) pass, for example `Patient.name[-1]` and the literal parts of `testLiterals`; the PR lists them. No whole group is expected to pass with T0008 alone, because the groups also use operators and functions:
  - `testIndexer` needs `=` and `|` (completed by T0010)
  - `testCollectionBoolean` needs `iif()` (completed by T0014)
  - `testDollar` needs `where`, `skip`, `substring`, `length`, `children` and a semantic check (completed by T0013, with T0012, T0015, T0017 and T0024)
