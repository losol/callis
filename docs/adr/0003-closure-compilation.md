# ADR-0003: Compile the AST to closures

- **Status:** Accepted (owner review, 2026-11-03)
- **Date:** 2026-11-03

## Context

Typical workloads evaluate a small set of expressions many times (indexing search parameters, validating invariants). An AST interpreter repeats dispatch and lookups on every evaluation. Generating JS source with `new Function` is fastest, but it breaks under CSP and is hard to debug.

## Decision

`compile()` builds a tree of closures once. All static decisions (function lookup, operator choice, literal construction, type-specifier resolution, constant folding) happen at compile time.

## Consequences

Close to code-generation speed without `eval`, and only slightly more complex than an interpreter. Stack traces show closures rather than AST nodes, so errors carry explicit source spans and a debug trace mode can be added.
