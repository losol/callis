# ADR-0004: Synchronous core with a MaybePromise async path

- **Status:** Accepted (pending owner review in the architecture PR)
- **Date:** 2026-11-03

## Context

Most of FHIRPath is CPU-bound, but `resolve()`, `memberOf()` and similar may need I/O, which in JavaScript is asynchronous. Making everything async costs a promise per node and forces async on every user. Alternatives considered:

- sync only, with hosts pre-fetching
- two separate evaluators
- suspend-and-replay: throw on a cache miss, await, then re-run

## Decision

One closure tree that returns `MaybePromise<Collection>`. `evaluate()` is synchronous and rejects async hooks; `evaluateAsync()` allows them. Value functions are plain sync code; lambda and host functions use small helpers.

## Consequences

A single code path and function library. Promises are detected structurally (a callable `then`, not `instanceof Promise`) at the hook and user-defined-function boundaries: rejected in sync mode, normalized in async mode. Cross-realm promises and custom thenables are therefore handled. Sync mode costs one cheap property check per node. Authors of lambda functions must use the helpers, and tests must run each lambda function in both modes, including cross-realm and custom-thenable hook results. Specializing sync-only closures is a later performance option.
