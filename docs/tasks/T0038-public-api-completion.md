# T0038 — Complete the phase-1 public API and documentation

Part of the [roadmap](../roadmap.md). Phase 1 · wave 7 · size L.

- **Depends on:** [T0025](T0025-public-api-release.md), [T0007](T0007-ucum.md), [T0010](T0010-operators.md), [T0011](T0011-fn-existence.md), [T0012](T0012-fn-filtering.md), [T0013](T0013-fn-subsetting-combining.md), [T0014](T0014-fn-conversion.md), [T0015](T0015-fn-string.md), [T0016](T0016-fn-math.md), [T0017](T0017-fn-tree-utility.md), [T0021](T0021-hooks-async.md), [T0023](T0023-xml-fixture-conversion.md), [T0024](T0024-static-analysis.md) (together they cover all of phase 1)
- **Parallel with:** –
- **Background:** [ADR-0009](../adr/0009-esm-only-zero-deps.md), [ADR-0012](../adr/0012-evaluation-defaults.md) (option and output defaults)

## Goal

Complete the public API as the remaining phase-1 capabilities land, through later 0.x releases. This preserves the full API design deferred from T0025; it is neither a prerequisite for the first 0.1.0 nor a definition of 1.0. Read [T0025](T0025-public-api-release.md) for the initial surface and [T0037](T0037-first-release-readiness.md) for release readiness.

## Scope

- `src/api/`:
  - final `parse`, `analyze`, `compile`, `evaluate`, `evaluateAsync` with overloads for `output: 'typed'`
  - option validation
  - an LRU compile cache
  - complete `plain` and `typed` output adapters
- `src/index.ts`: exports only the public API and public types.
- The conformance runner's evaluator adapter switches from the internal API (T0008) to the public API, so the published surface is what gets measured.
- Type tests (`expectTypeOf`) for the public API.
- **Documentation:**
  - README quick start
  - `docs/guide.md`: model-less use, R4/R5, units, async hooks, errors, output modes
  - generated API reference (TypeDoc) or a decision not to generate one
  - `spec-notes.md` completed, with the conformance report linked
- An `examples/` folder that runs in CI.
- Extend the existing release documentation and examples for later 0.x releases; reuse the workflow and owner process in [RELEASING.md](../../RELEASING.md).
- Validate model options, including rejecting an empty or `System` namespace ([#60](https://github.com/losol/callis/issues/60)).
- Public `parse`, AST inputs and the compiled `ast` property require the parser chain-depth fix [#107](https://github.com/losol/callis/issues/107), with bounded-tree regression tests. Until it is resolved, keep these internal and report this completion task blocked; do not delay T0025 for them.

## Design notes

### Public API sketch

This is the later target surface, not the initial 0.1 contract. Add each option only with its implemented capability and regression/type tests. Preserve T0025 call shapes and existing exported contracts.

```ts
import { compile, evaluate, evaluateAsync, parse } from '@callis/core';
import { r4 } from '@callis/fhir-r4';
import { ucum } from '@callis/ucum';

// One-off evaluation; compiled expressions are cached internally
const given = evaluate(patient, 'Patient.name.given');

// Compile once, evaluate many times
const isHigh = compile("Observation.value.ofType(Quantity) > 5 'mg/dL'", { model: r4, units: ucum });
isHigh.evaluate(observation);                       // unknown[]  (plain output)
isHigh.evaluate(observation, { output: 'typed' });  // FhirPathValue[]

// Hooks that need I/O
const names = await evaluateAsync(bundle, 'Bundle.entry.resource.subject.resolve().name', {
  model: r4,
  hooks: { resolve: (ref) => client.read(ref) },
});

// AST for tooling
const ast = parse("name.where(use = 'official').given");
```

```ts
function parse(expression: string, options?: ParseOptions): ExpressionNode;
function analyze(expression: string | ExpressionNode, options?: CompileOptions): AnalysisResult;
function compile(expression: string | ExpressionNode, options?: CompileOptions): CompiledExpression;
function evaluate(input: unknown, expression: string | CompiledExpression, options?: CompileOptions & EvaluateOptions): unknown[];
function evaluateAsync(input: unknown, expression: string | CompiledExpression, options?: CompileOptions & EvaluateOptions): Promise<unknown[]>;
// Overloads return FhirPathValue[] when `output: 'typed'`.

interface CompileOptions {
  model?: ModelProvider;
  units?: UnitSystem;                    // default: minimal built-in unit system
  functions?: FunctionRegistry;          // default: standard + FHIR
  inputType?: string;                    // enables model-aware analysis, e.g. 'Patient'
  knownVariables?: readonly string[];    // names of %variables, for compile-time checking (values come via EvaluateOptions.variables)
  strict?: boolean;                      // N1 §11 strict evaluation
  lenient?: { choiceSuffix?: boolean };
}

interface EvaluateOptions {
  variables?: Record<string, unknown>;
  resource?: unknown;                    // overrides %resource
  rootResource?: unknown;                // overrides %rootResource
  hooks?: EvaluationHooks;
  now?: Date | (() => Date);
  timezoneOffset?: number | 'local';     // minutes, for values without an offset; default 0 (UTC), 'local' = host offset
  output?: 'plain' | 'typed';
  decimalOutput?: 'number' | 'string';   // plain output only; default 'number'
  limits?: EvaluationLimits;             // bounded work; see architecture "Security and robustness"
  signal?: CancellationSignal;           // async only; any AbortSignal fits (T0021)
  concurrency?: number;                  // async only
}

interface EvaluationLimits {
  maxRepeatItems?: number;               // items one repeat() call may produce; finite default chosen in T0012
  maxCollectionSize?: number;            // items in any intermediate collection; finite default
}

interface CompiledExpression {
  readonly expression: string;
  readonly ast: ExpressionNode;
  evaluate(input: unknown, options?: EvaluateOptions): unknown[];
  evaluateAsync(input: unknown, options?: EvaluateOptions): Promise<unknown[]>;
}
```

**Output modes**

- **`plain`** (default):
  - Boolean, String and Integer become JavaScript primitives.
  - Decimal becomes a `number` (or a string with `decimalOutput: 'string'`).
  - Date, DateTime and Time become FHIR-formatted strings (no `@`).
  - Quantity becomes `{ value, unit, system?, code? }`.
  - Model nodes become the underlying JSON. An extension-only primitive comes out as its `_name` object.
- **`typed`** returns Callis values (`Decimal`, `DateTimeValue`, `Quantity`, `ModelNode` with type information) without loss.

**Compile cache:** calling `evaluate()` with a string uses a bounded LRU cache of compiled expressions. The key is the expression plus the identity of its compile options. Its size is configurable, and it can be turned off.

**Stability:** 0.1.0 does not freeze the API. Until 1.0, any public API may change in a minor version, including breaking changes, and that includes the interfaces other packages implement, such as `ModelProvider`. Breaking is a last resort: public API is designed with later tasks in mind, and every breaking change states its reason and the alternatives considered under *Interface changes* in its PR, and is called out in its changeset ([API changes](../../CONTRIBUTING.md#api-changes)). Deciding what is frozen for 1.0 is a separate item in the [roadmap backlog](../roadmap.md#backlog-not-scheduled).

## Acceptance criteria

- [ ] Every phase-1 conformance test passes, or is listed with a reason in `spec-notes.md`.
- [ ] publint, attw, the zero-dependency check and the size budget all pass.
- [ ] The README and guide examples are executed in CI.
- [ ] Public API conformance matches the internal adapter without losing any baseline entries, including model, strict and async coverage.
- [ ] Later 0.x package tarballs install and run in fresh Node and Vite projects; publication remains an owner action.
- [ ] #60 option validation and #107 parser-depth prerequisites are covered. No future option is accepted as a silent no-op.
- [ ] Support, limitations and per-phase conformance documentation describe this release; 1.0 scope and criteria remain open.
