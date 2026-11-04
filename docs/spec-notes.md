# Spec notes

Interpretations of the FHIRPath specification that are not obvious from its text, and HL7 test-suite expectations that Callis deliberately does not follow. Each entry gives the spec section, the tests involved and the decision ([CONTRIBUTING](../CONTRIBUTING.md#specification-questions-and-decisions)). Entries are added in the PR that implements the behaviour.

## Date, DateTime and Time

Implemented in `packages/core/src/values/datetime/` ([T0005](tasks/T0005-date-time.md)).

### A value without a timezone offset is UTC

- **Spec:** [N1 Date/Time equality](https://hl7.org/fhirpath/N1/#datetime-equality) leaves the default offset for values without one to the implementation.
- **Tests:** `testEquality23` (`@2012-04-15T15:00:00Z = @2012-04-15T10:00:00`) and `testNEquality17` (the same with `!=`) expect empty. The suite notes that the result "could be impacted by the timezone of the engine running the test".
- **Decision:** The owner chose UTC as the default ([ADR-0012](adr/0012-evaluation-defaults.md)). The value without an offset is read as 10:00Z, so the results are `false` and `true`, and these two tests fail. No fixed default offset gives empty; that would need a policy where a missing offset is unknown (anywhere within ±14:00).

### Partial values across timezone offsets

- **Spec:** [N1 §6.2](https://hl7.org/fhirpath/N1/#comparison) compares "the values at each precision … respecting timezone offsets". It does not say how to normalize a value that is coarser than its offset (an hour-precision value at `+05:30`), or a Date compared with a DateTime that has an offset.
- **Tests:** none in the suite.
- **Decision:** Each value stands for the span of time its precision covers, in UTC: `@2018-03` is all of March, at the default offset. Spans that do not overlap are ordered, identical spans are equal, and anything else is empty. Seconds and milliseconds count as one precision, so a value with seconds is a single millisecond. For values that line up with their own precision, this is exactly the component-by-component rule. It also settles the edge cases: `@2015-02-04T10+05:30 = @2015-02-04T04:30Z` is empty, and `@2012-04-15 = @2012-04-15T01:00+10:00` is `false` at UTC (that instant is on 14 April in UTC) but empty at a default offset of `+10:00`.

### Fractional seconds in equivalence

- **Spec:** [N1 Date/Time equivalence](https://hl7.org/fhirpath/N1/#datetime-equivalence) compares seconds and milliseconds "with decimal equivalence semantics", which would round to the less precise operand. Its own example says `@2012-01-01T10:30:31.1 ~ @2012-01-01T10:30:31` is `false`.
- **Tests:** `testEquivalent18`, `testNotEquivalent18`.
- **Decision:** Follow the example and the tests: seconds are compared exactly, as for equality. `@T10:30:31 ~ @T10:30:31.0` is still `true`, because seconds and milliseconds count as one precision.

### A time on a partial date

- **Spec:** The [grammar](https://hl7.org/fhirpath/N1/grammar.html) defines `DATETIME` as `'@' DATEFORMAT 'T' (TIMEFORMAT TIMEZONEOFFSETFORMAT?)?`, which also matches `@2015T10:00` and `@2015-02T10`.
- **Tests:** none.
- **Decision:** Such a literal is not a date and time (ISO 8601 needs a full date before a time), so it is an invalid literal value, like `@2015-02-30`: the parser returns nothing and the compiler raises `eval/invalid-literal` at evaluation ([T0008](tasks/T0008-compiler-evaluator.md#invalid-literal-values)). The string forms for `toDateTime()` and FHIR `dateTime` reject it too.

### Quoted calendar keywords in arithmetic

- **Spec:** [3.0.0 Date/Time Arithmetic](https://hl7.org/fhirpath/STU3/) lists the calendar keywords unquoted and the UCUM units quoted.
- **Tests:** `testMinus5` (`@1974-12-25 - 1 'month'` is `@1974-11-25`), labelled "Contested".
- **Decision:** Follow the suite: a quoted calendar keyword (`'month'`, `'days'`) works like the keyword. Of the time units, only `'a'` and `'mo'` raise an error.

### Fractions in date/time arithmetic

- **Spec:** [3.0.0 Date/Time Arithmetic](https://hl7.org/fhirpath/STU3/) applies the fraction of a quantity "only … for second or millisecond precisions". For partial values it converts the quantity to the value's precision, "truncating any decimal fraction".
- **Tests:** `testPlusDate2` and `testPlusDate4` (`7.7 days` adds 7 days), `testPlusDate19` (`0.1 's'` adds 100 ms).
- **Decision:**
  - The precision in the first rule is the quantity's unit. Above seconds the fraction is dropped before anything else, so `@T10:00 + 1.5 hours` is `@T11:00`, not `@T11:30`.
  - Seconds keep their fraction down to milliseconds, and anything finer is dropped (`1.5 'ms'` adds 1 ms).
  - The result is then converted to the value's precision and truncated toward zero. A value with second precision ignores a fraction of a second (`@T10:00:00 + 0.5 seconds` is `@T10:00:00`), and `@2014 - 23 months` is `@2013`.

### String forms accepted by toDateTime() and toTime()

- **Spec:** [N1 §5.5](https://hl7.org/fhirpath/N1/#conversion) gives the formats `YYYY-MM-DDThh:mm:ss.fff(+|-)hh:mm` and `hh:mm:ss.fff(+|-)hh:mm`, and accepts partial values.
- **Tests:** `testLiteralYearToDateTime` … `testLiteralTZToDateTime`.
- **Decision:** Partial values are accepted to the same precisions as literals, including the hour alone (`'2015-02-04T14'`, `'14'`). A timezone on a time string is rejected, because Time values have none ([N1 §4.1.6](https://hl7.org/fhirpath/N1/#time)); the offset in the `toTime()` format is read as a slip in the text. Fractional seconds beyond milliseconds are truncated, as for FHIR `instant` values.

### Writing a zero offset

- **Spec:** [N1 toString()](https://hl7.org/fhirpath/N1/#tostring-string) shows offsets as `(+|-)hh:mm`, and [N1 §4.1.7](https://hl7.org/fhirpath/N1/#datetime) allows `Z` as a synonym for `+00:00`.
- **Decision:** `toString()` writes a zero offset as `Z`, whether the input had `Z`, `+00:00` or `-00:00`. Both forms are valid FHIR.
