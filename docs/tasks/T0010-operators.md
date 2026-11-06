# T0010 — Operators

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size L.

- **Depends on:** [T0008](T0008-compiler-evaluator.md), [T0009](T0009-equality-kernels.md)
- **Parallel with:** [T0011](T0011-fn-existence.md)–[T0018](T0018-model-aware-evaluation.md)

## Goal

All remaining N1 operators, with correct empty propagation, singleton rules and errors ([N1 §6](https://hl7.org/fhirpath/N1/#operations)).

## Scope

- `=`, `~`, `!=` and `!~` (on top of T0009).
- `<`, `>`, `<=` and `>=`.
- `+` for numbers, strings, quantities and date/time; `-`, `*`, `/`, `div` and `mod`; `&`.
- `|` (union with deduplication), `in` and `contains`.
- Integer overflow behaviour and division by zero (empty). Decimal `+`, `-`, `*`, `/` and `div` are also empty beyond the Decimal size bound, a coefficient of 10,000 digits and a scale of 10,000: the [T0004](T0004-decimal.md#design-notes) kernels return `undefined` ([3.0.0 §6.6](https://hl7.org/fhirpath/STU3/#math-1): overflow and underflow give empty).
- Date/time + quantity arithmetic, wired to T0005/T0006.
- Singleton checks through T0003’s `singleton()`: `eval/singleton-expected` for more than one item, `eval/type-mismatch` for a single operand of the wrong type ([#67](https://github.com/losol/callis/issues/67)).
- Remove the temporary `eval/not-implemented` error code, compiler stub and matching conformance classifier/test once all operators are wired ([#104](https://github.com/losol/callis/issues/104)).

## Acceptance criteria

- [x] Every self-contained operator example in N1 §6.1–6.7 has a table-driven test; examples requiring later-task functions or FHIR models remain covered by the pinned conformance fixtures until those tasks land (see implementation notes).
- [x] Empty propagation is tested for every operator, including `&` (empty = `''`) and `{} ~ {}` (`true`).
- [x] Conformance groups inspected: `testEquality`, `testNEquality`, `testEquivalent`, `testNotEquivalent`, `testLessThan`, `testLessOrEqual`, `testGreatorOrEqual`, `testGreaterThan`, `testIn`, `testContainsCollection`, `testBooleanLogicAnd`, `testBooleanLogicOr`, `testBooleanLogicXOr`, `testBooleanImplies`, `testPlus`, `testConcatenate`, `testMinus`, `testMultiply`, `testDivide`, `testDiv`, `testMod`, `testPrecedence`, `testQuantity` and `testIndexer`. Any failures that remain are explained in the PR.

## Implementation notes

- `runtime/operators.ts` selects equality, ordering and collection operations on top of T0009. The compiler selects each implementation once, then evaluates both operands left to right through the existing sync/async closure tree. Errors keep the operator span.
- `runtime/arithmetic.ts` performs singleton checks and System value conversion, uses 32-bit Integer results when both numeric operands are Integer (except `/`), and promotes mixed Integer/Decimal operations to Decimal. Decimal bounds and precision come from T0004; Quantity algebra and unit conversion from T0006 and the evaluation’s unit system; date/time arithmetic from T0005. Unsupported types are errors; unknown/incompatible units follow the provider’s empty-result rules. `&` accepts only Strings and treats empty as `''`.
- Equality and ordering keep input nodes intact for T0009’s model-less temporal comparison. Union preserves the original retained items and removes only duplicates whose equality is `true`. Membership searches for a `true` equality and otherwise returns `false`; empty and singleton rules apply to the searched operand. See [spec notes](../spec-notes.md#undetermined-equality-in-union-and-membership).
- Tests are in `packages/core/test/operators.test.ts` and `packages/ucum/test/operator-integration.test.ts`, alongside T0008’s existing Boolean/type/indexer tests. They cover all self-contained N1 operator examples, including the corrected ordering comments recorded in spec notes, and regression cases for bounds, precision, errors, provenance and async operands. N1’s illustrative `where`, `all`, `exists` and model-dependent examples remain fixtures for T0011–T0018/T0020; they do not authorize implementing those functions here.
- Required conformance-group residuals are due to `empty`/`count`/`exists` (T0011), `take`/`first`/`last` (T0013), conversions (T0014), `round` (T0016), `trace` (T0017), model-aware choice/Quantity navigation (T0018), and `extension` (T0020). In particular, `testQuantityUnitComparison` cannot exercise FHIR Quantity mapping until T0018. Exact case names and outcomes remain in the generated reports. No new exception or broad missing-feature classification is introduced.
- Fractional date/time quantities keep T0005’s truncation and precision rules. Warnings remain the diagnostics/hook follow-up [#52](https://github.com/losol/callis/issues/52), assigned to T0024/T0021; the operator adds no warning channel.
