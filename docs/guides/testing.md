# Testing

How tests are written in Callis. The overall strategy is in [architecture.md](../architecture.md#testing-strategy); this guide covers the day-to-day rules.

## Where tests live

- [Vitest](https://vitest.dev), with one project per package.
- Unit tests sit next to their source as `kebab-case.test.ts`.
- Tests that cross modules go in `packages/<package>/test/`.
- Benchmarks are `*.bench.ts` files. They are not part of the CI gate ([T0033](../tasks/T0033-performance.md)).

## Spec-driven tests

- Every example in the spec section a module implements becomes a test. Write them as tables with `it.each`, and give each row its source: a spec anchor or an HL7 test name.

  ```ts
  // https://hl7.org/fhirpath/N1/#datetime-equality
  it.each([
    ['@2012 = @2012', true],
    ['@2012-01 = @2012', undefined], // different precision: empty
  ])('%s', (expression, expected) => {
    expect(evaluateBoolean(expression)).toBe(expected);
  });
  ```

- Test names describe behaviour ("returns empty when the precisions differ"), not implementation.
- Assert on **error codes**, not on message text.

## What to cover

- The spec examples, then the edges:
  - empty input
  - more than one item where one is expected
  - type mismatches
  - boundaries such as leap years and Integer limits
- **Lambda and host functions** run in both sync and async mode, including hooks that return cross-realm promises or custom thenables ([ADR-0004](../adr/0004-sync-core-async-path.md)).
- **Invariants** use property-based tests with `fast-check`: Decimal against an oracle, date comparison laws, and parser fuzzing (which must never crash). Keep the number of runs bounded so CI stays fast. On failure, fast-check prints the seed; add the failing case as a regular test.

## Determinism

- No real clock, timezone, network or randomness. Inject `now`; the default timezone is UTC ([ADR-0012](../adr/0012-evaluation-defaults.md)).
- Tests do not depend on each other or on their order.

## Fixtures

- Fixtures are synthetic or official HL7 examples, never real patient data.
- Vendored fixtures record their source, version and license (for example `tools/conformance/fixtures/SOURCE.md`).
- Generated fixtures are regenerated with their script, never edited by hand.

## Conformance suite

- Run the conformance runner (`pnpm conformance`) whenever evaluation behaviour changes ([tools/conformance](../../tools/conformance/README.md)). `pnpm test:conformance -t <name>` shows a diff for each failing suite test.
- When tests start passing, update the baseline in the same PR (`pnpm conformance --update-baseline`). The baseline may only go up.
- Never remove a baseline entry to make CI pass. If a suite expectation is wrong for Callis, record it in `docs/spec-notes.md` with the reason and mark the test as an exception in [`tools/conformance/src/exceptions.ts`](../../tools/conformance/src/exceptions.ts).

## Snapshots and coverage

- Use snapshot tests only for formatted output, such as error formatting and reports, and review snapshot diffs like code.
- Line coverage for the core is reported with a target of 90% or more. Do not write tests only to raise coverage; test behaviour.
