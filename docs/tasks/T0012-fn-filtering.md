# T0012 — Functions: where

Part of the [roadmap](../roadmap.md). Phase 1 · wave 4 · size S.

- **Depends on:** [T0008](T0008-compiler-evaluator.md), [T0009](T0009-equality-kernels.md)
- **Issue:** [#24](https://github.com/losol/callis/issues/24)
- **Parallel with:** the remaining independent function groups
- **Background:** [T0025](T0025-public-api-release.md), [T0011](T0011-fn-existence.md), [T0042](T0042-fn-projection-completion.md)

## Goal

[N1 §5.2](https://hl7.org/fhirpath/N1/#filtering-and-projection): `where(criteria)` on the existing model-less evaluator, through the current synchronous public API.

## Scope

- Implement the filtering lambda with the T0008 helpers and a shared predicate helper reused by T0011. Preserve item order, provenance, input immutability and isolated evaluation frames.
- Predicate evaluation uses the canonical `singleton(result, 'Boolean', asBoolean)` from `runtime/singleton.ts` and `runtime/item-conversion.ts`, following [N1 §4.5](https://hl7.org/fhirpath/N1/#singleton-evaluation-of-collections) and the existing singleton-conversion interpretation in [spec notes](../spec-notes.md). Boolean true includes an item; false/empty excludes it. The existing single non-Boolean fallback yields true; more than one predicate item raises the existing singleton error. Do not substitute JavaScript truthiness, explicit string/number conversion or a new strict-only predicate policy. Read the where paragraph together with the shared singleton rule; record any newly exposed spec/suite ambiguity in the implementation PR.
- Preserve nested `$this`/`$index` and variable/focus rules. Exercise the existing internal sync/async helper paths without adding a public async API or host hooks.
- Register only this new function. Keep existing public signatures/options and implemented type functions unchanged. Documentation and playground examples must advertise only implemented capabilities.

The owner narrowed 0.2 to where/exists/count. The original select/repeat/ofType completion scope and every omitted acceptance criterion are preserved in [T0042](T0042-fn-projection-completion.md), not removed. There is no model-aware evaluation, lossless JSON, new option, select/repeat or public async expansion in this task.

## Acceptance criteria

- [ ] Spec examples and edge cases cover empty input, true/false/empty predicates, canonical single non-Boolean fallback, multi-item predicate errors, arity and preserved order/provenance; tests cite the spec anchors.
- [ ] Internal sync/async lambda tests preserve nested `$this`/`$index`; public compile/evaluate work synchronously on synthetic JSON without new options or input mutation.
- [ ] Standalone where behaviour passes focused spec/public tests. The pinned `testWhere` fixtures call count, so the where-only PR records that missing-function dependency honestly; the combined T0011 head must turn the full group green. Do not add count to this task or introduce a circular dependency. Baseline/report changes record actual passes without weakening tests or waiving unrelated unimplemented functions.
- [ ] README/guide and a synthetic playground example show model-less filtering through the public API, with a minor changeset and appropriate package/browser checks.
- [ ] The shared predicate helper is available to T0011, with no new coercion policy or unsupported function advertised.
