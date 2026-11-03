# ADR-0002: Hand-written lexer and Pratt parser

- **Status:** Accepted (owner review, 2026-11-03)
- **Date:** 2026-11-03

## Context

The official grammar is ANTLR. Generated parsers bring a runtime dependency (`antlr4`, which is large), poor error messages and little control over spans. Hand-written parsers for expression languages of this size are routine.

## Decision (owner)

Hand-written lexer, Pratt parser for operators, recursive descent for the rest. No parser generator.

## Consequences

No dependency, precise error messages and spans, and an easy place to add phase 2 syntax (`L` suffix, instance selector). Grammar conformance must be shown by tests: the precedence table, every spec example, and the in-scope `syntax`-invalid cases in the suite (out-of-scope groups and mislabelled cases are listed in `spec-notes.md`; see [T0002](../tasks/T0002-parser.md)).
