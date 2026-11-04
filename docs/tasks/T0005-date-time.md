# T0005 — Date, DateTime and Time values

Part of the [roadmap](../roadmap.md). Phase 1 · wave 1 · size L.

- **Depends on:** [T0000](T0000-scaffold.md)
- **Parallel with:** [T0001](T0001-lexer.md), [T0003](T0003-types-and-collections.md), [T0004](T0004-decimal.md), [T0022](T0022-conformance-runner.md)
- **Conformance groups:** `period` (with T0018)
- **Background:** [ADR-0006](../adr/0006-own-date-time-types.md), [ADR-0012](../adr/0012-evaluation-defaults.md) (UTC as default offset)

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
  readonly month: number | undefined;  readonly day: number | undefined;
  readonly hour: number | undefined;   readonly minute: number | undefined;
  readonly second: number | undefined; readonly millisecond: number | undefined;
  readonly precision: Precision;
  readonly offsetMinutes: number | undefined;   // undefined = no timezone; 'Z' = 0

  static tryCreate(fields: DateTimeFields): DateTimeValue | undefined;  // undefined if invalid
  static create(fields: DateTimeFields): DateTimeValue;                 // throws eval/datetime-out-of-range
  static fromDate(date: DateValue): DateTimeValue;                      // implicit Date → DateTime
  toDateValue(): DateValue;
  toString(): string;   // FHIRPath toString() and FHIR JSON form: '2014-01-25T14:30Z'
  toLiteral(): string;  // '@2014-01-25T14:30Z'
  toJSON(): string;     // same as toString()
}
// DateValue: year..day. TimeValue: hour..millisecond, no timezone (N1 §4.1.6).
// Every value is valid: the constructor is private, and the factories check the components.
```

**Parsing** covers FHIRPath literals (`@2014-01-25T14:30:14.559+01:00`, `@T14:30`, `@2015T`), FHIR JSON strings (`date`, `dateTime`, `instant`, `time`), and string input to `toDate()`, `toDateTime()` and `toTime()`. Values are validated: month 1–12, days per month including leap years, hour 0–23, minutes and seconds 0–59, offset within ±14:00. Fractional seconds beyond milliseconds (allowed in FHIR `instant`) are truncated to milliseconds, which is the minimum precision required by [N1 §4.1.7](https://hl7.org/fhirpath/N1/#datetime).

**Comparison and equality** ([N1 §6.1.1, Date/Time equality](https://hl7.org/fhirpath/N1/#datetime-equality)):

1. If both values have a timezone offset, both are normalized to UTC.
2. If only one has an offset, the evaluation's **default offset** is applied to the other. The `timezoneOffset` option controls this. The default is **UTC** (offset 0), so results are the same on every machine ([ADR-0012](../adr/0012-evaluation-defaults.md)); `timezoneOffset: 'local'` uses the host's offset at the evaluation's `now`. N1 leaves this to the implementation and suggests the server's local offset.
3. Components are compared from the year down. If one side lacks a component the other has, the result is undetermined (empty). Seconds and milliseconds are compared as one decimal value.
4. For equivalence (`~`), different precision gives `false`.

Callis implements rules 1–3 by treating each value as the span of time its precision covers, in UTC: spans that do not overlap are ordered, identical spans are equal, and anything else is empty. For values that line up with their precision this is the same as rule 3; it also gives a sound answer when an offset shifts a partial value off its grid (an hour-precision value at `+05:30`, or a Date at a non-zero default offset). See `spec-notes.md`.

**Arithmetic** ([N1 §6.7](https://hl7.org/fhirpath/N1/#datetime-arithmetic)):

- `+` and `-` take time-valued quantities and use calendar semantics.
  - The fixed-length UCUM units `'wk'`, `'d'`, `'h'`, `'min'`, `'s'` and `'ms'` are accepted and behave like `week`, `day`, `hour`, `minute`, `second` and `millisecond`.
  - Only the variable-length UCUM units `'a'` and `'mo'` raise an error; authors must write `year` or `month` instead. N1 forbade every definite duration above seconds, but 3.0.0's date/time arithmetic table narrows the error to `'a'` and `'mo'`, and the suite agrees (`testPlusDate13`/`15`/`21`/`22` succeed, `testPlusDate14`/`16` fail).
  - Units that are not time units (`'cm'`) raise an error (`testMinus6`).
  - The suite also accepts a calendar keyword written as a quoted unit (`@1974-12-25 - 1 'month'`, `testMinus5`, marked "contested"). Callis follows it and records this in `spec-notes.md`.
- When adding months or years lands on an invalid day, it is clamped to the last day of the month (`@2020-01-31 + 1 month = @2020-02-29`).
- For partial values, the quantity is converted to the value's precision and truncated: `@2014 + 23 months = @2015`. Following 3.0.0, a year-only value takes months directly as years (÷ 12); other conversions go through days, with 30 days to a month and 365 days to a year (`@2026-02 + 5 weeks = @2026-03`).
- Above seconds the fraction of the amount is dropped (`7.7 days` adds 7 days); seconds keep their fraction down to milliseconds (`0.1 's'` adds 100 ms).
- The allowed units depend on the value type: Date takes year to day; Time takes hour to millisecond. Time wraps around midnight (`@T23:30 + 1 hour = @T00:30`, 3.0.0).
- A Date or DateTime result outside 0001–9999 raises `eval/datetime-out-of-range`.

**Current time:** `now()`, `today()` and `timeOfDay()` are captured **once per evaluation**, as [N1 §5.9.2](https://hl7.org/fhirpath/N1/#current-date-and-time-functions) requires. Hosts can inject `now` for deterministic tests.

### Module interface

What the runtime tasks consume from `src/values/datetime/` (nothing is exported from the package entry yet; that is [T0025](T0025-public-api-release.md)):

| File | Exports | Used by |
| --- | --- | --- |
| `date.ts`, `datetime.ts`, `time.ts` | `DateValue`, `DateTimeValue`, `TimeValue` and their `…Fields` types | everything |
| `temporal-value.ts`, `precision.ts` | `TemporalValue` (the union), `Precision`, `DatePrecision`, `TimePrecision` | T0003, T0009 |
| `parse.ts` | `parseTemporalLiteral('@…')`, `parseDate`, `parseDateTime` (also FHIR `instant`), `parseTime`; each returns `undefined` for invalid input | T0008 literals (`eval/invalid-literal`), T0014, T0018 |
| `compare.ts` | `compareTemporal(a, b, defaultOffsetMinutes = 0): -1 \| 0 \| 1 \| undefined` (throws `eval/type-mismatch` for Time against Date/DateTime), `temporalEquals` (`boolean \| undefined`), `temporalEquivalent` (`boolean`) | T0009 |
| `arithmetic.ts` | `addCalendar(value, amount, unit)`, `subtractCalendar(value, amount, unit)`; `amount` is a `number` or any `{ coefficient: bigint; scale: number }`, so a T0004 `Decimal` fits; `unit` is the quantity's unit string | T0010 |
| `now.ts` | `resolveTimezoneOffset(option, at)` for the `timezoneOffset` option, and `takeNowSnapshot(at, offsetMinutes)` → `{ now, today, timeOfDay }` | T0017, T0025 |

Error codes added by this task: `eval/datetime-out-of-range` (invalid components, or arithmetic leaving 0001–9999) and `eval/invalid-calendar-unit` (`'a'`, `'mo'`, a non-time unit, or a unit the value type does not take).

## Acceptance criteria

- [ ] All examples in [N1 §4.1.5–4.1.7](https://hl7.org/fhirpath/N1/#date), [Date/Time equality](https://hl7.org/fhirpath/N1/#datetime-equality), [§6.2](https://hl7.org/fhirpath/N1/#comparison) and [§6.7](https://hl7.org/fhirpath/N1/#datetime-arithmetic) have tests.
- [ ] Leap years, month ends (`@2020-01-31 + 1 month = @2020-02-29`), negative amounts, offsets of ±14:00, and `Z` are covered.
- [ ] Property tests cover antisymmetry and transitivity of comparison, and `a = b` ⇒ `a ~ b` when both have the same precision.
- [ ] No dependency on `Date`'s local timezone, except through the explicit default-offset parameter.
