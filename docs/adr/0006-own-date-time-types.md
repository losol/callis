# ADR-0006: Own date/time value types

- **Status:** Accepted (pending owner review in the architecture PR)
- **Date:** 2026-11-03

## Context

FHIRPath dates have partial precision (`@2014`, `@2014-01`), optional timezone offsets and calendar arithmetic with month-end clamping. `Date` cannot represent partial values. Temporal is not available in every target runtime (for example Node 22), and it has no concept of partial precision either. Date libraries add dependencies and still need a wrapper.

## Decision

Small immutable `DateValue`, `DateTimeValue` and `TimeValue` classes with their own parsing, validation, comparison and arithmetic.

## Consequences

No dependency and exact spec semantics. Leap years, month lengths and offsets must be handled and tested carefully. Leap seconds and historical calendars are not supported, which is also outside the spec.
