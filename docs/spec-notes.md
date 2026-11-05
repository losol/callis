# Specification notes

How Callis reads the FHIRPath specification where the text is ambiguous, silent, or disagrees with the HL7 test suite. Each entry gives the spec link, the affected tests and the decision. Entries are added in the same PR as the code ([AGENTS.md](../AGENTS.md#the-specification)).

## Decimal

### Precision and rounding of division

- **Spec:** [N1 §4.1.4](https://hl7.org/fhirpath/N1/#decimal) asks for at least 28 digits with 8 decimal places; [N1 §6.6.2](https://hl7.org/fhirpath/N1/#division) does not say how many digits a quotient keeps or how it is rounded.
- **Tests:** `testDivide1`–`testDivide7`, `testComment6` (`2 / 2` is the decimal `1`), `testEquivalent11`, `testNEquality22`.
- **Decision:** the quotient is rounded half away from zero to 28 significant digits, or to 8 digits after the decimal point if that keeps more, and trailing zeros are then removed. So `1 / 3` is `0.3333333333333333333333333333`, `4 / 2` is `2` and `1 / 2` is `0.5`. Half away from zero matches `round()` ([3.0.0](https://hl7.org/fhirpath/STU3/#fn-round)). Negative integer powers use the same division ([T0004](tasks/T0004-decimal.md)).

### `round()` never adds digits

- **Spec:** [N1 `round`](https://hl7.org/fhirpath/N1/#roundprecision-integer-decimal) and [3.0.0 `round`](https://hl7.org/fhirpath/STU3/#fn-round) say the precision is "the decimal place at which the rounding will occur", but not what happens when the input has fewer decimal places.
- **Tests:** `testRound1`, `testRound2` (not affected either way).
- **Decision:** `round(n)` rounds half away from zero to `n` decimal places, and a value that already has at most `n` decimal places is returned unchanged: `1.5.round(3)` is `1.5`, not `1.500`. Padding would claim precision the value does not have, and it would let `x.round(2147483647)` allocate a huge number.

### Rounding in decimal equivalence

- **Spec:** [N1 §6.1.2](https://hl7.org/fhirpath/N1/#equivalent) compares "values rounded to the precision of the least precise operand" and ignores trailing zeros when determining precision, but does not name the rounding mode.
- **Tests:** `testEquivalent8`–`testEquivalent13`, `testNotEquivalent8`–`testNotEquivalent13`.
- **Decision:** both values are rounded half away from zero, as `round()` does. A consequence of ignoring trailing zeros is that `1.04 ~ 1.0` is `true`: `1.0` counts as precision 0.

### Results that cannot be represented are empty

- **Spec:** [3.0.0 §6.6](https://hl7.org/fhirpath/STU3/#math-1) makes arithmetic overflow and underflow empty; [`power`](https://hl7.org/fhirpath/STU3/#powerexponent--integer--decimal--decimal) and [`sqrt`](https://hl7.org/fhirpath/STU3/#sqrt--decimal) are empty when the result "cannot be represented".
- **Tests:** `testPower3`, `testSqrt2`.
- **Decision:** the Decimal kernels for `sqrt`, `exp`, `ln`, `log` and `power` return empty for `NaN`, infinite results and results that underflow to zero although the exact value is not zero. Results beyond the [size of a Decimal](#size-of-a-decimal) are empty too. For a whole exponent the bound applies to the exact power `|base|^|exponent|`; for a negative exponent that is the denominator, so `2.power(-40000)` is empty although 28 digits of it would fit. The scale counts, so `0.1.power(10001)` and `1.0.power(100000)` are empty. Where 3.0.0 asks for an error instead of empty (for example `log()` of a non-positive number), the function layer ([T0016](tasks/T0016-fn-math.md)) raises it.

### Size of a Decimal

- **Spec:** [N1 §4.1.4](https://hl7.org/fhirpath/N1/#decimal) asks for at least 28 digits with 8 decimal places and lets implementations support more. [3.0.0 §6.6](https://hl7.org/fhirpath/STU3/#math-1) makes arithmetic overflow and underflow empty. Neither sets an upper limit.
- **Tests:** none in the suite come near the bound.
- **Decision** (owner, [#47](https://github.com/losol/callis/issues/47), 2026-11-04): a Decimal's coefficient has at most 10,000 digits and its scale is at most 10,000. An operation whose exact result is beyond that (`+`, `-`, `*`, `/`, `div`, `power`, `ln`, `log`) is overflow or underflow and gives empty. So `1e9999 + 1e-10000`, which needs 20,000 digits, is empty, and repeated squaring ends in empty instead of an error. Division keeps its 28 significant digits and its 8 digits after the point rather than rounding to fit. So `1 / 3e9980` is empty, and so is a quotient from about `1e9992` up that is not exact within fewer digits (`1e9995 / 3`). Text beyond the bound does not parse, so `toDecimal()` gives empty. A Decimal literal beyond the bound is a valid token with no Decimal value. It is an invalid literal value: it raises `eval/invalid-literal` when evaluated, like `@2015-02-30` (owner, [#69](https://github.com/losol/callis/issues/69), 2026-11-05; [T0008](tasks/T0008-compiler-evaluator.md#invalid-literal-values)).

## Lexer

### Unknown escape sequences are syntax errors

- **Spec:** [N1 §4.1.2](https://hl7.org/fhirpath/N1/#string) lists the escapes `\'`, `\"`, `` \` ``, `\r`, `\n`, `\t`, `\f`, `\\` and `\uXXXX`, and says that "if a `\` is used at the beginning of a non-escape sequence, it will be ignored": `'\p'` is `'p'`, `'\u005'` is `'u005'`, and `'\'` is `''`. [3.0.0](https://hl7.org/fhirpath/STU3/#string) repeats the rule. The grammar's `ESC` rule also allows `\/`; the N1 grammar lacks `\"`, which the 3.0.0 grammar adds.
- **Suite:** `testLiteralUnicodeInvalid` expects `'\u+041'` to be a syntax error, which contradicts the rule. `testLiteralStringEscapes` uses `\'` as an escaped quote, which contradicts `'\'` being `''`.
- **Decision:** follow the suite and [T0001](tasks/T0001-lexer.md). The escapes listed above and `\/` are recognized; any other sequence that starts with `\` raises `syntax/invalid-escape`, and `'\'` is an unterminated string. This applies to strings, delimited identifiers and quoted environment variable names. The owner confirmed this on 2026-11-04. (T0001)

### Escaped surrogates must form a pair

- **Spec:** [3.0.0 §String](https://hl7.org/fhirpath/STU3/#string): `\uXXXX` escapes are UTF-16 code units, and an escaped surrogate "must be paired with a corresponding high or low surrogate to form a valid Unicode scalar value". N1 says nothing about it.
- **Suite:** no tests.
- **Decision:** an escaped high surrogate that is not followed by a low surrogate, or an escaped low surrogate that does not follow a high surrogate, raises `syntax/invalid-escape`. The other half of the pair may be escaped or not. Unescaped characters are not checked. (T0001)

### A time zone on a Time literal is read by the lexer

- **Spec:** [N1 §4.1.6](https://hl7.org/fhirpath/N1/#time) says Time values have no time zone, and the grammar's `TIME` token has no offset.
- **Suite:** `testLiteralTimeUTC` (`@T14:34:28Z.is(Time)`) and `testLiteralTimeTimezoneOffset` (`@T14:34:28+10:00.is(Time)`) are labelled `invalid="execution"`, not `syntax`.
- **Decision:** follow the suite. The lexer reads `Z` or `±hh:mm` as part of the Time token, and the compiler raises `eval/invalid-literal` when the literal is evaluated ([T0008: invalid literal values](tasks/T0008-compiler-evaluator.md#invalid-literal-values)). (T0001)

### Date and time literals end at the longest valid shape

- **Spec:** the `DATE`, `DATETIME` and `TIME` tokens of the [grammar](https://hl7.org/fhirpath/N1/grammar.html). An ANTLR lexer takes the longest input that matches a token.
- **Suite:** `testLiteralDateTimeSecond` (`@2015-02-04T14:34:28.is(DateTime)`), `testLiteralTimeMillisecond` and the other `testLiteral*` tests need a `.` without a digit after it to end the literal.
- **Decision:** the lexer takes the same longest match, so `@2015-1` lexes as `@2015`, `-`, `1`, and `@T14:30+01` as `@T14:30`, `+`, `01`. When a literal is directly followed by a digit or a `:`, as in `@2015-01-01T14:3` or `@20150`, the lexer raises `syntax/invalid-date-literal` for the whole malformed literal. The grammar cannot accept such input either, so this changes only the error, not which expressions are valid. (T0001)

### Environment variables are single tokens

- **Spec:** [N1 §9](https://hl7.org/fhirpath/N1/#environment-variables) calls an environment variable "a token introduced by a %", whose name is an identifier, a delimited identifier, or (for backwards compatibility) a string. The grammar's `externalConstant` is a parser rule, which would allow whitespace after the `%`. The FHIR pages ([R4](https://hl7.org/fhir/R4/fhirpath.html#vars), [R5](https://hl7.org/fhir/R5/fhirpath.html#vars)) write the names in double quotes: `%"vs-[name]"`, `%"ext-[name]"`.
- **Suite:** `testVariables3` (`%ucum`), `testVariables4` (`` %`vs-administrative-gender` ``) and `testExtension2` (`` %`ext-patient-birthTime` ``).
- **Decision:** `%` and its name form one `EnvironmentVariable` token, so nothing may come between them (`% ucum` is an error). The double-quoted form is accepted as a compatibility extension, with the same escapes as strings. A `"` anywhere else is an unexpected character. The owner confirmed this on 2026-11-04. (T0001)

## Types

### Type names are case-sensitive, and qualified names do not fall back

- **Spec:** [N1 §10.1 Models](https://hl7.org/fhirpath/N1/#models)
- **Tests:** `testType5`, `testType11`–`testType14`, `testType22`
- **Decision:** Type names and namespaces are matched exactly. An unqualified name is looked up in the model namespace, then in `System`, so with the FHIR model `boolean` is `FHIR.boolean` and `Boolean` is `System.Boolean`; `Patient.active.is(Boolean)` is false. A qualified name is looked up in its own namespace only: `System.Patient` and `FHIR.Boolean` do not resolve.
- **Consequence:** with the FHIR model, the unqualified `Quantity` is `FHIR.Quantity`, so `5 'mg' is Quantity` is false (the literal is a `System.Quantity`) and `5 'mg' is System.Quantity` is true. The suite writes `System.Quantity` when it tests literals (`testDecimalLiteralIsNotQuantity`). Without a model, `Quantity` is `System.Quantity`.
- **Code:** `resolveTypeSpecifier()` in `packages/core/src/types/type-specifier.ts` ([T0003](tasks/T0003-types-and-collections.md)).

### Every type is a `System.Any`, including model types

- **Spec:** [N1 §4.1 Literals](https://hl7.org/fhirpath/N1/#literals) calls `System.Any` "an ultimate root type"; 3.0.0's reflection section defines it as the base type of the primitives.
- **Tests:** none in the suite.
- **Decision:** `is System.Any` (and `as`, `ofType()`) is true for every type, System or model.
- **Code:** `isOfType()` in `packages/core/src/types/type-test.ts` ([T0003](tasks/T0003-types-and-collections.md)).

### FHIR primitives in `is`, `as` and `ofType()`

- **Spec:** [R5 §2.1.9.1.2](https://hl7.org/fhir/R5/fhirpath.html#types); [N1 §6.3](https://hl7.org/fhirpath/N1/#types), [§5.2.4](https://hl7.org/fhirpath/N1/#oftypetype-type-specifier-collection)
- **Tests:** `testType11`–`testType14`, `testFHIRPathIsFunction1`–`10`, `testFHIRPathAsFunction11`–`22`
- **Decision:**
  - `is` does not treat a FHIR primitive as the System type it converts to: `Patient.active.is(System.Boolean)` is false. R5 lifts this restriction for `ofType()` only, so `as` behaves like `is`, and `Patient.name.given.ofType(System.String)` keeps the given names.
  - All three accept subtypes through the model's inheritance, as N1 says for each of them. `Patient.gender.is(string)` is true because `code` derives from `string`.
  - The suite marks `testFHIRPathAsFunction11` (`Patient.gender.as(string)`) and `testFHIRPathAsFunction16` (`Patient.gender.ofType(string)`) as contested and expects them to be empty. Callis follows the spec and returns the code. These two tests become exceptions when the conformance runner first runs them with a model ([T0018](tasks/T0018-model-aware-evaluation.md)).
- **Code:** `isOfType()` and `matchesOfType()` in `packages/core/src/types/type-test.ts` ([T0003](tasks/T0003-types-and-collections.md)).

### `FHIR.date` maps to `System.Date`

- **Spec:** the mapping table in [R5 §2.1.9.1.2](https://hl7.org/fhir/R5/fhirpath.html#types) maps `FHIR.date` to `System.DateTime`.
- **Tests:** `testExtractBirthDate` expects `birthDate` to have output type `date`.
- **Decision:** `FHIR.date` maps to `System.Date`, as the suite and the other major implementations do. `dateTime` and `instant` map to `System.DateTime`.
- **Consequence:** `Patient.birthDate.ofType(System.Date)` keeps the birth date and `Patient.birthDate.ofType(System.DateTime)` is empty, although R5's table suggests the opposite. `ofType()` filters by type and does not apply the implicit `Date → DateTime` conversion.
- **Code:** the `ModelProvider.getSystemType()` contract in `packages/core/src/model/model-provider.ts` ([T0003](tasks/T0003-types-and-collections.md)); the generated models implement it ([T0019](tasks/T0019-fhir-model-generator.md)).

## Collections and evaluation

### Singleton evaluation uses implicit conversions only

- **Spec:** [N1 §4.5](https://hl7.org/fhirpath/N1/#singleton-evaluation-of-collections) says a single item is used if it "can be converted to the expected input type"; 3.0.0 says "implicitly converted".
- **Tests:** none specific.
- **Decision:** Only the implicit conversions of [N1 §5.5](https://hl7.org/fhirpath/N1/#conversion) apply. A single `'5'` where an Integer is expected is an error (`eval/singleton-expected`), not `5`; where a Boolean is expected it is `true` (step 2).
- **Code:** `singleton()` in `packages/core/src/runtime/singleton.ts` ([T0003](tasks/T0003-types-and-collections.md)).

## Strings

### String equivalence

- **Spec:** [N1 string equivalence](https://hl7.org/fhirpath/N1/#string-equivalence), clarified in 3.0.0
- **Tests:** `testEquivalent5`–`7`, `testNotEquivalent5`–`7`
- **Decision:** Two strings are equivalent when they are equal after this normalization:
  - Every character with the Unicode `White_Space` property becomes a space, as 3.0.0 specifies. Runs of whitespace are not collapsed and the ends are not trimmed (3.0.0 says so explicitly), so `'a  b' ~ 'a b'` is false. U+FEFF, which JavaScript's `\s` matches, is not whitespace.
  - Case is folded without locale rules by converting to upper case and then to lower case. This approximates Unicode full case folding: `'Straße' ~ 'STRASSE'` and `'σ' ~ 'ς'` are true, and Turkish dotted and dotless i get no special treatment. The spec asks to ignore case "and locale" but names no algorithm.
  - No Unicode normalization (NFC/NFD) is applied, because the spec does not ask for it: a precomposed `é` is not equivalent to `e` followed by a combining accent.
- **Code:** `normalizeStringForEquivalence()` in `packages/core/src/values/string.ts` ([T0003](tasks/T0003-types-and-collections.md)).

### String ordering is by code point

- **Spec:** [N1 §6.2](https://hl7.org/fhirpath/N1/#comparison): "String ordering is strictly lexical and is based on the Unicode value of the individual characters."
- **Tests:** none in the suite.
- **Decision:** strings are ordered by Unicode code point. JavaScript's `<` compares UTF-16 code units, which puts characters above U+FFFF (surrogate pairs) before U+E000–U+FFFF; Callis corrects for that, so `'\uFFFF' < '\u{10000}'` is true. No locale collation is used.
- **Code:** `compareStrings()` in `packages/core/src/values/string.ts` ([T0003](tasks/T0003-types-and-collections.md)).

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

### Leap seconds

- **Spec:** FHIR's [`dateTime`, `instant` and `time`](https://hl7.org/fhir/R4/datatypes.html#dateTime) patterns allow the second `60`. FHIRPath's own ranges stop at `:59` ([N1 §4.1.6](https://hl7.org/fhirpath/N1/#time), [§4.1.7](https://hl7.org/fhirpath/N1/#datetime)).
- **Tests:** none.
- **Decision:** leap seconds are not supported ([ADR-0006](adr/0006-own-date-time-types.md)). A value with the second `60`, such as `2015-12-31T23:59:60Z`, does not parse, so `toDateTime()` gives empty for it, and arithmetic and comparison never meet one.

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
  - Weeks follow the first rule too: the fraction is dropped before the weeks become days, so `1.5 weeks` adds 7 days, not 10. Reading "multiply by 7, then calculate in days" as 10.5 days, truncated to 10, is also defensible; Callis treats weeks like every other unit above seconds.
- **R4 suite:** the R4 copy of the suite (`tests-fhir-r4.xml`) still expects `testPlusDate19` to ignore the fraction (`@1973-12-25T00:00:00.000+10:00 + 0.1 's'` unchanged). Callis follows the R5 copy, which is the source of truth and matches 3.0.0, so `testPlusDate19` is an expected failure in the R4 report.

### String forms accepted by toDateTime() and toTime()

- **Spec:** [N1 §5.5](https://hl7.org/fhirpath/N1/#conversion) gives the formats `YYYY-MM-DDThh:mm:ss.fff(+|-)hh:mm` and `hh:mm:ss.fff(+|-)hh:mm`, and accepts partial values.
- **Tests:** `testLiteralYearToDateTime` … `testLiteralTZToDateTime`.
- **Decision:** Partial values are accepted to the same precisions as literals, including the hour alone (`'2015-02-04T14'`, `'14'`). A timezone on a time string is rejected, because Time values have none ([N1 §4.1.6](https://hl7.org/fhirpath/N1/#time)); the offset in the `toTime()` format is read as a slip in the text. Fractional seconds beyond milliseconds are truncated, as for FHIR `instant` values.

### Writing a zero offset

- **Spec:** [N1 toString()](https://hl7.org/fhirpath/N1/#tostring-string) shows offsets as `(+|-)hh:mm`, and [N1 §4.1.7](https://hl7.org/fhirpath/N1/#datetime) allows `Z` as a synonym for `+00:00`.
- **Decision:** `toString()` writes a zero offset as `Z`, whether the input had `Z`, `+00:00` or `-00:00`. Both forms are valid FHIR.

## Conformance suite

How the conformance runner ([T0022](tasks/T0022-conformance-runner.md), [`tools/conformance`](../tools/conformance/README.md)) reads the attributes of the [HL7 test suite](https://github.com/FHIR/fhir-test-cases/tree/master/r5/fhirpath). The test schema is vendored as `tools/conformance/fixtures/r5/testSchema.xsd`.

### Semantic errors found during evaluation

- **Spec:** [N1 §11](https://hl7.org/fhirpath/N1/#type-safety-and-strict-evaluation) lets an implementation check types at compile time or at run time.
- **Tests:** every `invalid="semantic"` test, for example `testDollarOrderNotAllowed`, `isEffectOnLogic3Base` and the `isSemanticChecks` group.
- **Decision:** a `FhirPathSemanticError` passes. A `FhirPathEvaluationError` also passes, and the report counts it as "detected late", so the gap to static analysis ([T0024](tasks/T0024-static-analysis.md)) stays visible.

### `ordered="true"` asks for ordered-function checks

- **Spec:** [N1 §11](https://hl7.org/fhirpath/N1/#type-safety-and-strict-evaluation) (strict evaluation) and the `ordered` attribute in `testSchema.xsd`, which documents it as "check the order of results".
- **Tests:** `testDollarOrderNotAllowed`. R4 marks it `checkOrderedFunctions="true"`, R5 marks the same test `ordered="true"`, and both expect a semantic error for `Patient.children().skip(1)` in strict mode.
- **Decision:** `ordered="true"` and `checkOrderedFunctions="true"` both ask the engine to report ordered functions on unordered input (`checkOrderedFunctions` in the adapter options). Results are compared in order unless `ordered="false"`, which is the schema's default reading anyway.

### `predicate="true"`

- **Spec:** the schema only says the test "represents a predicate".
- **Tests:** `testPatientHasBirthDate` (and `testExtractBirthDate`, which is `predicate="false"`).
- **Decision:** the result is converted to a Boolean before it is compared, as the HL7 Java test runner does: a single Boolean stays as it is; otherwise the result is `true` when it is not empty.

### Comparing expected outputs

- **Spec:** `testSchema.xsd` lists the output types `boolean`, `integer`, `decimal`, `string`, `date`, `dateTime`, `time`, `code`, `id` and `Quantity`, but not how values compare. The reference is the HL7 Java test runner (`FHIRPathTests.java` in [hapifhir/org.hl7.fhir.core](https://github.com/hapifhir/org.hl7.fhir.core)).
- **Tests:** all tests with outputs.
- **Decision:** follow the Java runner, except where noted.
  - The result item's type must be the output type. System types count as the output type of the same name (`System.Decimal` as `decimal`), FHIR types as their own name (`FHIR.code` as `code`), as Java compares `fhirType()`. So an expected `string` does not accept a `code`, and FHIR types the schema does not list (`uri`, `instant`, `Age`) never match a typed output.
  - Decimals compare by value and by number of decimal places, because precision is visible in FHIRPath and Callis keeps it ([ADR-0005](adr/0005-bigint-decimal.md); [N1 §4.1.4](https://hl7.org/fhirpath/N1/#decimal) asks for fixed-precision decimals). `1.50` does not match `1.5`. Java compares the text; Callis also treats `-0.0` as `0.0`, `+1` as `1` and `01` as `1`.
  - Dates, date/times and times compare as text without the `@` and `T` literal prefixes, so a different precision or a different way of writing the offset is a different value.
  - Quantities compare by value (as decimals) and by unit.
  - An output with empty text checks only the type, as in Java.
  - Outputs without a type (the R4 boundary tests) hold a FHIRPath literal, as the schema says; Java compares only their text. Callis compares by the kind of literal (Boolean, number, string, date/time or quantity) and accepts any result type of that kind: the R4 file writes `@2014-01` for a month-precision DateTime, which as a literal would be a Date.
  - With `ordered="false"`, each output must pair with a different result item. Java only checks that each result item matches some output.

### Tests that use STU features inside phase-1 groups

- **Spec:** [ADR-0001](adr/0001-spec-baseline.md) puts STU features in phase 2.
- **Tests:** `testPeriodInvariantNew` (group `period`) uses `lowBoundary()` and `highBoundary()`; the `type()` tests in `testType` and the `matchesFull()` tests in `testMatches` are STU too.
- **Decision:** tests are classified one by one: a test that calls an STU function is STU, even in a group whose other tests are phase 1. The reports show the task that implements it.

### Modes

- **Spec:** the `mode` values in `testSchema.xsd`.
- **Tests:** the tests and groups with a `mode`.
- **Decision:** `strict`, `lenient/polymorphics`, `element`, `html` and the `semantic` group mode of `isSemanticChecks` (not in the schema) are phase 1. `tx` (`%terminologies`) is STU ([T0032](tasks/T0032-fhir-phase2.md)). `cda` and `custom` are out of scope and skipped, as are the whole `cdaTests` and `documentFunctions` groups, including their tests that have their own `mode="element"`.

### Duplicate test names

- **Tests:** the R4 file has two tests named `testEquivalent23` (R5 renamed the second to `testEquivalent24`).
- **Decision:** test IDs are the names, made unique with a `#2`, `#3`, … suffix in document order. The second R4 test is `testEquivalent23#2` in reports and in the baseline.
