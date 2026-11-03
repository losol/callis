# Architecture decision records

Each file records one architecture decision: its context, the decision and its consequences. The [architecture overview](../architecture.md) summarizes them; the [tasks](../roadmap.md) carry the detailed design.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-spec-baseline.md) | Specification baseline | Accepted |
| [0002](0002-hand-written-parser.md) | Hand-written lexer and Pratt parser | Accepted |
| [0003](0003-closure-compilation.md) | Compile the AST to closures | Accepted |
| [0004](0004-sync-core-async-path.md) | Synchronous core with a MaybePromise async path | Accepted |
| [0005](0005-bigint-decimal.md) | Own BigInt-based Decimal | Accepted |
| [0006](0006-own-date-time-types.md) | Own date/time value types | Accepted |
| [0007](0007-ucum-split.md) | Minimal unit system in core, full UCUM in `@callis/ucum` | Accepted |
| [0008](0008-model-provider.md) | ModelProvider with generated FHIR models in separate packages | Accepted |
| [0009](0009-esm-only-zero-deps.md) | ESM-only packages without runtime dependencies | Accepted |
| [0010](0010-tooling.md) | Tooling: pnpm, TypeScript 7, tsdown, Biome, Vitest, Changesets | Accepted |
| [0011](0011-conformance-suite.md) | HL7 test suite as the conformance arbiter | Accepted |
| [0012](0012-evaluation-defaults.md) | Evaluation and output defaults (UTC, Decimal as `number`, strict choice types) | Accepted |

All ADRs were accepted by the owner on 2026-11-03, when the architecture PR was reviewed.

## Adding or changing a decision

- **New decision:** copy an existing file, take the next number, and fill in `Status`, `Date`, `Context`, `Decision` and `Consequences`. Keep it short; put the detailed design in the task that implements it.
- **Changed decision:** do not rewrite history. Add a new ADR, and set the old one's status to `Superseded by ADR-NNNN`.
- **Same PR:** add or update the ADR in the PR that makes the change, and update the table above and the key-decisions table in [architecture.md](../architecture.md#key-decisions).
