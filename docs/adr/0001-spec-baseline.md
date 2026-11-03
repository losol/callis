# ADR-0001: Specification baseline

- **Status:** Accepted (pending owner review in the architecture PR)
- **Date:** 2026-11-03

## Context

The owner chose N1 normative plus FHIR additions for phase 1. FHIRPath 3.0.0 (July 2026) has since been published; it keeps N1's normative content, adds STU features, and clarifies many rules. The official test suite follows 3.0.0.

## Decision

Implement the N1 normative content and the FHIR additions in phase 1, plus N1's Math functions (STU in N1, but in the owner's list). Where 3.0.0 clarifies a normative rule, follow 3.0.0 and the test suite. Implement STU features in phase 2. Record interpretations in `docs/spec-notes.md`.

## Consequences

Behaviour matches the current published spec and the tests, not the 2020 text where the two differ. The conformance report must separate phase 1 tests from STU tests so progress is measured against the right target.
