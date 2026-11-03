# T0005 — Date, DateTime and Time values

Part of the [roadmap](../roadmap.md). Phase 1 · wave 1 · size L.

- **Depends on:** [T0000](T0000-scaffold.md)
- **Parallel with:** [T0001](T0001-lexer.md), [T0003](T0003-types-and-collections.md), [T0004](T0004-decimal.md), [T0022](T0022-conformance-runner.md)
- **Conformance groups:** `period` (with T0018)
- **Background:** [ADR-0006](../adr/0006-own-date-time-types.md)

## Goal

Partial-precision date/time values with spec-compliant comparison and arithmetic ([design notes](#design-notes), [ADR-0006](../adr/0006-own-date-time-types.md)).

## Scope

- `src/values/datetime/`:
  - `DateValue`, `DateTimeValue` and `TimeValue`
  - parsing of FHIRPath literals and FHIR JSON strings (`date`, `dateTime`, `instant`, `time`), with validation
  - FHIRPath `toString()` and FHIR JSON formatting
- Comparison, equality and equivalence kernels:
  - precision-by-precision comparison, with seconds and milliseconds as one decimal precision
  - timezone normalization
  - a default-offset parameter for values without an offset
- Arithmetic with calendar units (`addCalendar(value, amount, unit)`), independent of the `Quantity` class:
  - month-end clamping
  - truncation of partial values
  - allowed units per type
  - the fixed-length UCUM units `'wk'`, `'d'`, `'h'`, `'min'`, `'s'` and `'ms'` are accepted as their calendar equivalents; only `'a'` and `'mo'` raise an error (3.0.0, tests `testPlusDate13`–`22`)
- Helpers for taking the `now` snapshot.

## Design notes

**Decision ([ADR-0006](../adr/0006-own-date-time-types.md)):** Callis has its own small immutable value types, with no date library and no Temporal.

```ts
type Precision = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'millisecond';

class DateTimeValue {
  readonly year: number;
  readonly month?: number;  readonly day?: number;
  readonly hour?: number;   readonly minute?: number;
  readonly second?: number; readonly millisecond?: number;
  readonly precision: Precision;
  readonly offsetMinutes?: number;   // undefined = no timezone; 'Z' = 0
}
// DateValue: year..day. TimeValue: hour..millisecond, no timezone (N1 §4.1.6).
```

**Parsing** covers FHIRPath literals (`@2014-01-25T14:30:14.559+01:00`, `@T14:30`, `@2015T`), FHIR JSON strings (`date`, `dateTime`, `instant`, `time`), and string input to `toDate()`, `toDateTime()` and `toTime()`. Values are validated: month 1–12, days per month including leap years, hour 0–23, minutes and seconds 0–59, offset within ±14:00. Fractional seconds beyond milliseconds (allowed in FHIR `instant`) are truncated to milliseconds, which is the minimum precision required by [N1 §4.1.7](https://hl7.org/fhirpath/N1/#datetime).

**Comparison and equality** ([N1 §6.1.1, Date/Time equality](https://hl7.org/fhirpath/N1/#datetime-equality)):

1. If both values have a timezone offset, both are normalized to UTC.
2. If only one has an offset, the evaluation's **default offset** is applied to the other. The `timezoneOffset` option controls this; the default is the host's local offset at the evaluation's `now`. N1 leaves this to the implementation and suggests the server's local offset.
3. Components are compared from the year down. If one side lacks a component the other has, the result is undetermined (empty). Seconds and milliseconds are compared as one decimal value.
4. For equivalence (`~`), different precision gives `false`.

**Arithmetic** ([N1 §6.7](https://hl7.org/fhirpath/N1/#datetime-arithmetic)):

- `+` and `-` take time-valued quantities and use calendar semantics.
  - The fixed-length UCUM units `'wk'`, `'d'`, `'h'`, `'min'`, `'s'` and `'ms'` are accepted and behave like `week`, `day`, `hour`, `minute`, `second` and `millisecond`.
  - Only the variable-length UCUM units `'a'` and `'mo'` raise an error; authors must write `year` or `month` instead. N1 forbade every definite duration above seconds, but 3.0.0's date/time arithmetic table narrows the error to `'a'` and `'mo'`, and the suite agrees (`testPlusDate13`/`15`/`21`/`22` succeed, `testPlusDate14`/`16` fail).
  - Units that are not time units (`'cm'`) raise an error (`testMinus6`).
  - The suite also accepts a calendar keyword written as a quoted unit (`@1974-12-25 - 1 'month'`, `testMinus5`, marked "contested"). Callis follows it and records this in `spec-notes.md`.
- When adding months or years lands on an invalid day, it is clamped to the last day of the month (`@2020-01-31 + 1 month = @2020-02-29`).
- For partial values, the quantity is converted to the value's precision and truncated: `@2014 + 23 months = @2015`.
- The allowed units depend on the value type: Date takes year to day; Time takes hour to millisecond.

**Current time:** `now()`, `today()` and `timeOfDay()` are captured **once per evaluation**, as [N1 §5.9.2](https://hl7.org/fhirpath/N1/#current-date-and-time-functions) requires. Hosts can inject `now` for deterministic tests.

## Acceptance criteria

- [ ] All examples in [N1 §4.1.5–4.1.7](https://hl7.org/fhirpath/N1/#date), [Date/Time equality](https://hl7.org/fhirpath/N1/#datetime-equality), [§6.2](https://hl7.org/fhirpath/N1/#comparison) and [§6.7](https://hl7.org/fhirpath/N1/#datetime-arithmetic) have tests.
- [ ] Leap years, month ends (`@2020-01-31 + 1 month = @2020-02-29`), negative amounts, offsets of ±14:00, and `Z` are covered.
- [ ] Property tests cover antisymmetry and transitivity of comparison, and `a = b` ⇒ `a ~ b` when both have the same precision.
- [ ] No dependency on `Date`'s local timezone, except through the explicit default-offset parameter.
