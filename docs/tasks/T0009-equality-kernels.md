# T0009 — Equality, equivalence and ordering kernels

Part of the [roadmap](../roadmap.md). Phase 1 · wave 3 · size M.

- **Depends on:** [T0003](T0003-types-and-collections.md), [T0004](T0004-decimal.md), [T0005](T0005-date-time.md), [T0006](T0006-quantity.md)
- **Parallel with:** [T0007](T0007-ucum.md), [T0008](T0008-compiler-evaluator.md), [T0023](T0023-xml-fixture-conversion.md)

## Goal

Item-level and collection-level `equals`, `equivalent` and `compare` for every value kind ([equality and equivalence](#equality-and-equivalence)). The operators and collection functions build on these.

## Scope

- `src/runtime/equality.ts`:
  - dispatch over item kinds, including implicit conversions (Integer → Decimal, Date → DateTime) and `ModelNode` → System value conversion
  - recursive equality of complex values (JSON objects in model-less mode)
  - an extension point for model-specific equivalence, which T0020 uses for `Coding`/`CodeableConcept`
  - collection-level `=` (order-sensitive) and `~` (order-insensitive)
  - the return type is `true | false | undefined`
- `src/runtime/comparison.ts`: `compare(a, b): -1 | 0 | 1 | undefined`, and `eval/type-mismatch` for incompatible types.

## Design notes

### Equality and equivalence

The equality kernel returns `true | false | undefined` (undefined means "cannot be determined"). The comparison kernel returns `-1 | 0 | 1 | undefined`. Operators and collection functions build on these kernels.

| Type | `=` ([N1 §6.1.1](https://hl7.org/fhirpath/N1/#equals)) | `~` ([N1 §6.1.2](https://hl7.org/fhirpath/N1/#equivalent)) |
| --- | --- | --- |
| Either operand empty | empty | `{} ~ {}` is `true`; empty against non-empty is `false` |
| String | exact, case-sensitive | ignores case and locale, normalizes whitespace ([string equivalence](https://hl7.org/fhirpath/N1/#string-equivalence)) |
| Integer / Decimal | numeric value; trailing zeros ignored; Integer is converted to Decimal | compared after rounding to the precision of the less precise operand |
| Boolean | value | value |
| Date / DateTime / Time | compare precision by precision; a precision present on one side only gives empty; seconds and milliseconds count as one decimal precision; timezone offsets are respected ([T0005 design notes](T0005-date-time.md#design-notes)) | different precision gives `false` |
| Quantity | same dimension, converted via the unit system. Time units follow the [3.0.0 time-valued quantity table](https://hl7.org/fhirpath/STU3/): `week`, `day`, `hour`, `minute`, `second` and `millisecond` equal `'wk'`, `'d'`, `'h'`, `'min'`, `'s'` and `'ms'` (`7 days = 1 'wk'` is `true`, `testQuantity6`). `year`/`month` against `'a'`/`'mo'` cannot be compared and give empty (`1 year = 1 'a'`, `testEquality36`). N1's blanket "unequal above seconds" rule is superseded. | the same, except `year ~ 'a'` and `month ~ 'mo'` are `true` (`1 year ~ 1 'a'`) |
| Complex model data | all child properties equal, recursively | FHIR: `id` ignored; `Coding` compared on `system` + `code`; `CodeableConcept` equivalent if any of their codings are ([R5 §2.1.9.1.6](https://hl7.org/fhir/R5/fhirpath.html#changes)) |
| Collections with several items | same length, pairwise equal in order | same length, matched regardless of order |

`!=` is `not(=)` and `!~` is `not(~)`. The collection functions (`distinct`, `isDistinct`, `union`, `intersect`, `exclude`, `subsetOf`, `supersetOf`, `in`, `contains`) use `=` semantics. Each function decides how to treat an undetermined comparison; for example, `@2020.combine(@2020-01-01).isDistinct()` is empty in the test suite.

### Ordering

`<`, `>`, `<=` and `>=` ([N1 §6.2](https://hl7.org/fhirpath/N1/#comparison)) are defined for Integer, Decimal, String (by Unicode code point), Date, DateTime, Time and Quantity (with comparable units). Mixing incompatible types is an error. Partial-precision dates can give empty. Phase 2's `sort()` reuses the same kernel.

## Acceptance criteria

- [ ] Every row of the equality table in the [design notes](#equality-and-equivalence) has tests, including the "undetermined" cases (dates with different precision, incomparable quantities).
- [ ] Integer and Decimal mix correctly (`1 = 1.0`, `1 ~ 1.0`), and so do Date and DateTime.
- [ ] Equality of complex JSON objects is recursive and order-sensitive for arrays.
