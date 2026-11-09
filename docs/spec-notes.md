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

## Math functions

The math functions ([N1 §5.7](https://hl7.org/fhirpath/N1/#math), [T0016](tasks/T0016-fn-math.md)) are thin: the numbers come from the Decimal kernels (see [Decimal](#decimal)) and the functions add singleton evaluation, the implicit Integer → Decimal conversion and the Integer range.

### The result of `power()` is a Decimal

- **Spec:** [N1 `power`](https://hl7.org/fhirpath/N1/#powerexponent-integer-decimal-integer-decimal) says the result is an Integer when both operands are Integers. [3.0.0 `power`](https://hl7.org/fhirpath/STU3/#powerexponent--integer--decimal--decimal) says it is always a Decimal, "because raising an Integer to a negative power (such as -1) produces a Decimal result", and shows `2.power(3) // 8 (as a decimal)`.
- **Tests:** `testPower1`, `testPower2`, `testPower3`, `testPowerEmpty`–`testPowerEmpty3` (R5). Equality does not tell an Integer from a Decimal, so no suite test depends on it.
- **Decision:** follow 3.0.0 ([ADR-0001](adr/0001-spec-baseline.md)): `power()` always returns a Decimal, so `2.power(3)` is the Decimal `8` and `2.power(-1)` is `0.5`. The alternative, an Integer for non-negative whole exponents, would make the type of the result depend on the value of the exponent. `round()` follows the same 3.0.0 line: `1.round()` is the Decimal `1`.

### `log()` of zero or a negative number is an error, `ln()` is empty

- **Spec:** [3.0.0 `log`](https://hl7.org/fhirpath/STU3/#logbase--decimal--decimal) says that an input or a base of 0 or less ends the evaluation with an error. N1 has no such sentence, and neither version says anything about `ln()` of such a number or about base 1.
- **Tests:** `testLog1`, `testLog2`, `testLogEmpty`–`testLogEmpty3` (R5), `testLn1`, `testLn2`.
- **Decision:** `log()` raises `eval/invalid-argument` for an input or a base of zero or less, as 3.0.0 asks and as [Results that cannot be represented are empty](#results-that-cannot-be-represented-are-empty) announces. An empty input or an empty base is checked first, so `(-1).log({})` is empty. `ln()` has no such sentence and falls under "cannot be represented", so `0.ln()` and `(-1).ln()` are empty. Base 1 has no logarithm either, and gives empty, like division by zero.

### Integer results outside the Integer range are empty

- **Spec:** [3.0.0 §6.6](https://hl7.org/fhirpath/STU3/#math-1) makes overflow and underflow empty. `ceiling()`, `floor()` and `truncate()` return an Integer, and `abs()` returns the type of its input, but a Decimal can hold a whole number beyond the [32-bit Integer range](https://hl7.org/fhirpath/N1/#integer).
- **Tests:** none in the suite.
- **Decision:** the result is empty when it is not an Integer: `3000000000.5.floor()` and `(-2147483648).abs()` are empty, like the Integer overflow of `+` and `*`. The input of `ceiling()`, `floor()` and `truncate()` may be an Integer, which is returned as it is.

### `round()` with an empty or a negative precision

- **Spec:** [N1 `round`](https://hl7.org/fhirpath/N1/#roundprecision-integer-decimal) requires a precision of 0 or more, "or the evaluation will end and signal an error". It does not say what an empty precision (`1.5.round({})`) gives; `log()` and `power()` say that an empty argument gives an empty result.
- **Tests:** `testRound1`, `testRound2`, `testRoundEmpty` (R5).
- **Decision:** a precision that is left out is 0; an empty precision gives an empty result, as for `log()` and `power()`. A negative precision raises `eval/invalid-argument` even when the input is empty, because the argument is wrong whatever the input. A precision that is not an Integer (`2.5.round(1.5)`) raises `eval/type-mismatch`.

### `ceiling()`, `floor()`, `round()` and `truncate()` of a Quantity

- **Spec:** N1 lists `Quantity` only for `abs()`. 3.0.0 also lets [`ceiling()`](https://hl7.org/fhirpath/STU3/#ceiling--integer--quantity), [`floor()`](https://hl7.org/fhirpath/STU3/#floor--integer--quantity) and [`truncate()`](https://hl7.org/fhirpath/STU3/#truncate--integer--quantity) take a Quantity: "the result is a Quantity with the same units and the value (Decimal) set to the integer result calculated". [`round()`](https://hl7.org/fhirpath/STU3/#roundprecision--integer--decimal--quantity) gives "a Quantity with the same units".
- **Tests:** none in the suite; `testAbs3` covers `abs()`.
- **Decision:** follow 3.0.0 ([ADR-0001](adr/0001-spec-baseline.md), #176): the four functions keep the unit, so `(5.5 'mg').ceiling()` is `6 'mg'` and `(5.55 'mg').round(1)` is `5.6 'mg'`. The value stays a Decimal, as the value of every Quantity is ([N1 §4.1.8](https://hl7.org/fhirpath/N1/#quantity)): `ceiling()`, `floor()` and `truncate()` give the whole number without digits after the point (`(5.0 'mg').floor()` is `5 'mg'`), and `round()` rounds it like any Decimal. Since that value is not an Integer, the Integer range does not apply: `(3000000000.5 'mg').floor()` is `3000000000 'mg'`, while `3000000000.5.floor()` is empty ([Integer results outside the Integer range are empty](#integer-results-outside-the-integer-range-are-empty)). The other math functions still raise `eval/type-mismatch` for a Quantity.

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

### Unresolved type specifiers are execution errors

- **Spec:** [N1 `is`](https://hl7.org/fhirpath/N1/#is-type-specifier) and [`as`](https://hl7.org/fhirpath/N1/#as-type-specifier) require an error when the target identifier does not resolve. The permanent [3.0.0 `is`](https://hl7.org/fhirpath/STU3/en/#is-type-specifier) and [`as`](https://hl7.org/fhirpath/STU3/en/#as-type-specifier) retain that rule; [3.0.0 `ofType`](https://hl7.org/fhirpath/STU3/en/#oftypetype--type-specifier--collection) likewise requires a type identifier that resolves. [Type safety](https://hl7.org/fhirpath/STU3/en/#type-safety-and-strict-evaluation) permits implementation choices about compile-time versus runtime checks.
- **Pinned tests:** both R4 and R5 at [`cb4eac4`](../tools/conformance/fixtures/SOURCE.md) classify `testFHIRPathAsFunction23` (`Patient.gender.as(string1)`) and `24` (`Patient.gender.ofType(string1)`) as `invalid="execution"`. `testType22` (`Patient.is(System.Patient).not()`) instead expects true. These are all phase-1 tests under the runner's per-test classifier; the surrounding group's reflection tests are STU. R5's description explicitly permits a resolution error for `System.Patient`; R4 lacks that description but has the same positive assertion.
- **Decision:** an unresolved type is an execution error (`FhirPathEvaluationError`, `eval/unknown-type`) for `is`/`as` and their function forms and for `ofType()`. Resolution is still performed once during compilation; an unresolved result compiles to a closure that raises at the evaluated use site, before matching or empty-input handling. Constant folding must preserve this timing. Unreached lazy branches do not raise it. Analysis can emit a `semantic/unknown-type` warning, including in strict mode, without preventing compilation. This agrees with the execution-error fixtures and closure architecture.
- **No namespace exemption:** `System.Patient`, `FHIR.Boolean` with a FHIR model, unknown namespaces and unknown unqualified names with a model all error. A known namespace does not define all possible type names. Resolved nonmatching targets still give false/empty under the ordinary operator rules. The separate model-less unqualified extension below is the only resource-name fallback.
- **Narrow suite exception:** follow the normative error rule rather than making `System.Patient` a special always-false target. Under [ADR-0011](adr/0011-conformance-suite.md), only `testType22` is registered, for R4 and R5, in `tools/conformance/src/exceptions.ts` with this heading as its note, since the conformance runner evaluates with a model ([T0018](tasks/T0018-model-aware-evaluation.md)). The vendored tests are unchanged, and the exception is reported as skipped, not passed. `testFHIRPathAsFunction23`/`24` remain ordinary phase-1 tests expecting execution errors, and pass.
- **Ownership:** [T0008](tasks/T0008-compiler-evaluator.md#type-names-that-do-not-resolve) implements target handling and adds the evaluation error code; [T0042](tasks/T0042-fn-projection-completion.md) reuses it for `ofType()` (it moved there from T0012 when T0012 was narrowed to `where`), T0018 integrates model types and the named exception, T0024 preserves error timing in diagnostics. T0003's pure resolver and System/model subtype helpers remain unchanged. This resolves the planning choice in [#58](https://github.com/losol/callis/issues/58), not its future implementation.

### Resource type names without a model

- **Spec:** [N1 models](https://hl7.org/fhirpath/N1/#models) and [3.0.0 type specifiers](https://hl7.org/fhirpath/STU3/en/#is-type-specifier) assume known types; they do not define Callis's plain-JSON model-less mode. The [T0003 model principles](tasks/T0003-types-and-collections.md#model-principles) already give resources a name through `resourceType`.
- **Tests:** no official model-less fixture defines this behavior. The matcher's tests are in `runtime/type-target.test.ts` and `test/evaluate.test.ts` (T0008), and [T0042](tasks/T0042-fn-projection-completion.md) adds the `ofType()` cases such as `Bundle.entry.resource.ofType(Patient)`. Between them they cover exact matching, invalid qualifiers, System precedence, empty/multiple input, and inherited or invalid `resourceType`. T0018 covers model-present exclusion.
- **Decision:** only without a model, an unqualified name that does not resolve to System is a resource-name target. It matches input objects with an own string `resourceType` exactly equal to the name (case-sensitive), never primitives, inherited properties or missing/non-string values. It needs no FHIR registry or input-dependent type discovery; the pure resolver still returns `undefined`. A name absent from the data, including a typo, is a valid nonmatching resource-name target, so singleton `is` gives false and `as`/`ofType()` give empty. This loss of typo detection is intentional and confined to this mode.
- **Limits:** no inheritance is inferred, so a Patient does not match `Resource` or `DomainResource`. System targets take precedence, and qualified unresolved names (`System.Patient`, `FHIR.Patient` without a model, `Foo.Patient`) raise `eval/unknown-type`. With a model, never use this fallback even if an individual node lacks a model type: the provider decides its model type. Existing FHIR primitive rules, including `ofType()`'s mapped-System support, remain unchanged.
- **Cardinality:** for a valid target use 3.0.0's empty `is` result (false), empty `as`/`ofType()` results, and singleton errors for multi-item `is`/`as`. Unknown qualified targets still error on empty input, as above. Input shape never turns an unresolved target into a mismatch.
- **Ownership:** [T0008](tasks/T0008-compiler-evaluator.md#resource-type-names-without-a-model) builds the runtime matcher and shares the own-property exact-name rule with the model-less root identifier; [T0042](tasks/T0042-fn-projection-completion.md) reuses it for `ofType()`, T0018 disables it when a model is supplied, and T0024 recognizes these valid model-less targets ([#59](https://github.com/losol/callis/issues/59)). T0008 and T0018 implemented the runtime contracts; the `ofType()` function (T0042) and the analyzer (T0024) still have to reuse them. None of this changes the pure type helpers.

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
  - The suite marks `testFHIRPathAsFunction11` (`Patient.gender.as(string)`) and `testFHIRPathAsFunction16` (`Patient.gender.ofType(string)`) as contested and expects them to be empty. Callis follows the spec and returns the code. Both are registered as exceptions for R4 and R5 in `tools/conformance/src/exceptions.ts`, since the conformance runner evaluates with a model ([T0018](tasks/T0018-model-aware-evaluation.md), [#111](https://github.com/losol/callis/issues/111)); `testFHIRPathAsFunction11` left the baseline that way.
- **Code:** `isOfType()` and `matchesOfType()` in `packages/core/src/types/type-test.ts` ([T0003](tasks/T0003-types-and-collections.md)).

### `FHIR.date` maps to `System.Date`

- **Spec:** the mapping table in [R5 §2.1.9.1.2](https://hl7.org/fhir/R5/fhirpath.html#types) maps `FHIR.date` to `System.DateTime`.
- **Tests:** `testExtractBirthDate` expects `birthDate` to have output type `date`.
- **Decision:** `FHIR.date` maps to `System.Date`, as the suite and the other major implementations do. `dateTime` and `instant` map to `System.DateTime`. The R6 draft `6.0.0-snapshot1` corrects its table to `System.Date` (FHIR-55637 in the [page's change notes](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#types)), so this decision agrees with it.
- **Consequence:** `Patient.birthDate.ofType(System.Date)` keeps the birth date and `Patient.birthDate.ofType(System.DateTime)` is empty, although R5's table suggests the opposite. `ofType()` filters by type and does not apply the implicit `Date → DateTime` conversion.
- **Code:** the `ModelProvider.getSystemType()` contract in `packages/core/src/model/model-provider.ts` ([T0003](tasks/T0003-types-and-collections.md)); the generated models implement it ([T0019](tasks/T0019-fhir-model-generator.md)).

### The `id` of a resource is an `id`, the `id` of any other element a `string`

- **Spec:** the published definitions of [R4 `Resource.id`](https://hl7.org/fhir/R4/resource-definitions.html#Resource.id) (type `id`) and [R4 `Element.id`](https://hl7.org/fhir/R4/element-definitions.html#Element.id) (type `string`); [R5](https://hl7.org/fhir/R5/resource-definitions.html#Resource.id) and [R6](https://hl7.org/fhir/6.0.0-snapshot1/resource-definitions.html#Resource.id) give `Resource.id` the same type. [`ElementDefinition.base`](https://hl7.org/fhir/R5/elementdefinition-definitions.html#ElementDefinition.base) names the one element that defines an inherited element, and a [snapshot](https://hl7.org/fhir/R5/structuredefinition.html#snapshot) holds the base's element unless the differential changes it.
- **Tests:** `testContainedId` (R4) expects `contained.id` to have the output type `id`. It already passed with R5.
- **Source:** the System-typed `id` elements in the pinned packages carry their FHIR type in `structuredefinition-fhir-type`, and the sources disagree with the published definitions and with themselves:
  - R4 4.0.1 gives `Resource.id` the type `string`, in both its snapshot and its differential, and so do the 147 resources that inherit it.
  - R5 5.0.0 is right for `Resource.id` and its 161 copies, but gives 46 datatypes (`Address.id`, `Age.id`, …) the type `id` although they inherit `Element.id`, a `string`.
  - R6 6.0.0-snapshot1 is right for `Resource.id` and 7 resources, but gives the 116 others (`Patient.id`, …) the type `string`.
  - `Element.id` (`string`) and `Extension.url` (`uri`) agree with their published definitions in all three, and so does every other element typed this way.
- **Decision:**
  - The generator reads the FHIR type of an inherited element from the element that defines it, through `base.path`, not from its own snapshot copy. An element that its differential redefines keeps its own type.
  - The one defining element that contradicts its published type, R4 `Resource.id`, is corrected by an entry in the release table in `tools/model-gen/src/cli.ts`. An entry names the value it replaces. Generation fails when the source no longer carries that value, or when nothing uses the entry, so changing the pin means reviewing it.
- **Consequence:** in the R4, R5 and R6 models every resource's `id` is an `id` and every other `id` a `string`, so `Patient.id is id` and `contained.id is id` are true, and `Address.id is string` is true. Against the earlier output, 148 R4 resources and 116 R6 resources change from `string` to `id`, and 46 R5 datatypes from `id` to `string`.
- **Code:** `generateModel()` in `tools/model-gen/src/generate.ts` and the corrections in `tools/model-gen/src/cli.ts` ([T0019](tasks/T0019-fhir-model-generator.md)).

## Collections and evaluation

### Singleton evaluation uses implicit conversions only

- **Spec:** [N1 §4.5](https://hl7.org/fhirpath/N1/#singleton-evaluation-of-collections) says a single item is used if it "can be converted to the expected input type"; 3.0.0 says "implicitly converted".
- **Tests:** none specific.
- **Decision:** Only the implicit conversions of [N1 §5.5](https://hl7.org/fhirpath/N1/#conversion) apply. A single `'5'` where an Integer is expected is an error, not `5`; where a Boolean is expected it is `true` (step 2).
- **Error codes:** the spec only says that evaluation "will signal an error". More than one item raises `eval/singleton-expected`; a single item that does not convert raises `eval/type-mismatch`, because its type is the problem and `first()` would not help. The owner decided this on 2026-11-05.
- **Code:** `singleton()` in `packages/core/src/runtime/singleton.ts` ([T0003](tasks/T0003-types-and-collections.md)).

### Integer literals outside the 32-bit range

- **Spec:** [N1 §4.1](https://hl7.org/fhirpath/N1/#literals) makes `Integer` a 32-bit signed integer, but the grammar's `NUMBER` token has no size limit, and N1 does not say what an Integer literal beyond the range means. FHIRPath 3.0.0 adds `Long` literals with an `L` suffix (STU, [T0028](tasks/T0028-stu-long.md)).
- **Tests:** `testLiteralIntegerMax` (`2147483647`, valid); none beyond the range.
- **Decision:** an Integer literal outside -2,147,483,648 to 2,147,483,647 is an invalid literal value: it compiles, and raises `eval/invalid-literal` when it is evaluated, like `@2015-02-30` ([T0008: invalid literal values](tasks/T0008-compiler-evaluator.md#invalid-literal-values)). It does not silently become a Decimal or a Long. A sign written directly before the literal is part of its value, so `-2147483648` is valid although `2147483648` alone is not. Any further `+` or `-` follows the ordinary Integer rules, so `-(-2147483648)` overflows to empty, exactly as `-%i` does when `%i` is the smallest Integer.
- **Code:** `constantOf()` and `materialize()` in `packages/core/src/compiler/literal.ts`.

### Function arguments are evaluated with the focus of the call

- **Spec:** [N1 §5](https://hl7.org/fhirpath/N1/#functions) says how a function evaluates an expression parameter for each input item, but not what the focus of an ordinary argument is.
- **Tests:** none specific; `testCombine` and `testUnion` rely on it, for example `name.select(use.union(given))`.
- **Decision:** a value argument is evaluated with the same focus and iteration variables as the call itself, not with the call's input. In `name.select(use.union(given))`, `given` is evaluated on each name, as in the HL7 Java engine. Lambda arguments are evaluated per item (`where`, `select`) or once for the whole input (`iif`, [below](#scope-of-the-iif-arguments)), as the function decides.
- **Code:** `evaluateArgs()` and `bindLambda()` in `packages/core/src/compiler/lambda.ts`.

### Frame variables after a dot

- **Spec:** the [N1 grammar](https://hl7.org/fhirpath/N1/grammar.html) allows `$this`, `$index` and `$total` as an invocation after a dot (`name.$this`) but gives that form no meaning.
- **Tests:** none.
- **Decision:** the expression before the dot is evaluated, so its errors surface, and the result is the frame variable, as if it were written alone. `name.select(given.$index)` is the index of each name.
- **Code:** `compileFrameVariable()` in `packages/core/src/compiler/compile.ts`.

## Navigation

Implemented in `packages/core/src/runtime/navigation.ts` ([T0008](tasks/T0008-compiler-evaluator.md) without a model, [T0018](tasks/T0018-model-aware-evaluation.md) with one).

### Root identifiers with a model

- **Spec:** [N1 §10.1](https://hl7.org/fhirpath/N1/#models) and [R5 §2.1.9.1](https://hl7.org/fhir/R5/fhirpath.html#rules): a path may start with the type of the root node, and `Patient.name` on an input that is not a Patient is empty. Neither says how an identifier that is both a type name and an element name is read.
- **Tests:** `testSimpleWithContext`, `testSimpleBackTick1`, `testEscapedIdentifierUnicode`; `testSimpleWithWrongContext` expects a semantic error in strict mode ([T0024](tasks/T0024-static-analysis.md)).
- **Decision:** with a model, a leading identifier names a type when the model has a resource, complex or backbone type of that name. The result is each focus item whose model type is that type or a subtype of it (`DomainResource.contained` on a Patient), and empty for the other items. The data's `resourceType` is never consulted, so an object the model does not know (`resourceType: "Foo"`) matches no type name, and `Foo.name` is an ordinary path. A primitive type name is always an element name, because FHIR's primitives share their spelling with elements (`id`, `code`, `date`, `url`); so is any name the model does not know. Without a model the [model-less rule](tasks/T0008-compiler-evaluator.md#resource-type-names-without-a-model) applies: the identifier matches the item's own `resourceType` exactly. (T0018)

### Choice elements written with a type suffix

- **Spec:** [R5 §2.1.9.1.1](https://hl7.org/fhir/R5/fhirpath.html#polymorphism): a choice element is addressed by its name without `[x]`, and `Observation.valueQuantity` is not valid FHIRPath. [ADR-0012](adr/0012-evaluation-defaults.md) keeps the suffix form as an opt-in for compatibility.
- **Tests:** `testPolymorphismA`, `testPolymorphicsA`, `testPolymorphicsC` and `testPolymorphicsD` (`mode="lenient/polymorphics"`); `testPolymorphismB` and `testPolymorphicsB` expect a semantic error ([T0024](tasks/T0024-static-analysis.md)).
- **Decision:** `Observation.value` gives the one `value[x]` that is present, typed by its JSON key (`valueQuantity` is a `Quantity`, `valueString` a `string`), with its `_value[x]` extensions for a primitive. The suffix form is not an element: at runtime it is empty, like any element the type does not have, and static analysis will report it. With `lenient: { choiceSuffix: true }`, `Observation.valueQuantity` gives the value only when its type is `Quantity`, so `valueString` on the same observation is empty; the node is still named `value`. Without a model the suffix form is an ordinary JSON key. (T0018)

### Typed primitives that do not parse

- **Spec:** [R5 §2.1.9.1.2](https://hl7.org/fhir/R5/fhirpath.html#types) maps FHIR primitives to System types; it does not say what a value that is not valid for its type is.
- **Tests:** none in the suite; `node-value.test.ts`.
- **Decision:** a FHIR primitive whose JSON value is not valid for its type (a `date` written as `not a date` or with a time, a `boolean` written as `"true"`, a fraction where an `integer` is declared) keeps the plain JSON mapping of its value (`String`, `Decimal`, …) instead of raising an error: FHIRPath navigates the data it is given and does not validate it. Its model type is unchanged, so `is date` is still true. A FHIR `Quantity` without a UCUM `system` and `code` stays a complex value. (T0018)

### Children without a model

- **Spec:** [N1 §5.8](https://hl7.org/fhirpath/N1/#children-collection) lists the "immediate child nodes"; plain JSON has no element definitions.
- **Tests:** none in the suite; `navigation.test.ts`. The functions themselves are [T0017](tasks/T0017-fn-tree-utility.md).
- **Decision:** with a model, the children of a typed node are its elements in definition order, with the `_name` extensions folded into their primitives, and the children of a FHIR primitive are its `id` and `extension`. Without a model, or for a node the model does not know, the children are the own JSON properties in document order, except `resourceType`, which names the type rather than holding data, and keys starting with `_`, which hold the extensions of a primitive and are not elements themselves. (T0018)

### Order of `descendants()`

- **Spec:** [N1 §5.8.2](https://hl7.org/fhirpath/N1/#descendants-collection) calls `descendants()` a shorthand for `repeat(children())`, and [N1 §3.1](https://hl7.org/fhirpath/N1/#collections) leaves the order of both functions undefined. [`repeat()`](https://hl7.org/fhirpath/N1/#repeatprojection-expression-collection) only adds items that are new by `=`.
- **Tests:** `testRepeat3` and `testRepeat4` (counts), `testDistinct2` and `testDistinct3`; none depends on the order or on duplicate values.
- **Decision:** `descendants()` lists the nodes in document order: each node comes right before its own descendants, depth first, as XPath's descendant axis does. With a model, the order of each node's children is the definition order of [children without a model](#children-without-a-model). Every node is listed once and equal values are kept, so two `given` names with the same text are both descendants; deduplicating by `=` would drop one. The HL7 Java engine and fhirpath.js do not deduplicate either, but list the nodes level by level. The walk follows the data rather than the model's types, so it ends on a recursive element such as `Questionnaire.item.item`, and it keeps its own stack, so deep input cannot overflow the call stack. It does not detect cycles: JSON input is a tree, but a JavaScript object graph with a cycle, which only a host can pass, has no end, and the walk runs until memory runs out. The evaluation limits and the cancellation signal will bound it ([#186](https://github.com/losol/callis/issues/186)).
- **Code:** `descendantsFunction` in `packages/core/src/functions/tree.ts` ([T0017](tasks/T0017-fn-tree-utility.md)).

### `trace()` names and projections

- **Spec:** [N1 §5.9.1](https://hl7.org/fhirpath/N1/#tracename-string-projection-expression-collection) adds the input, or its projection, to "the diagnostic log" and returns the input unchanged. Its example, `contained.where(criteria).trace('unmatched', id).empty()`, traces the `id` of each item. It does not say how the log reaches the host, or what an empty or non-String `name` does.
- **Tests:** `testTrace1`, `testTrace2`, and `trace()` inside `testSkip3`, `testSplit3` and `testPrecedence6`.
- **Decision:**
  - The log is the `trace` hook of the evaluation ([T0021: host hooks](tasks/T0021-hooks-async.md#host-hooks)); without one, `trace()` only returns its input. The hook gets the name, the traced values converted like the evaluation's results (`output`, `decimalOutput`), and the span of the call, in evaluation order, also for empty input.
  - The projection is evaluated for each input item, with that item as `$this` and its `$index`, as `select()` does, and the results are traced as one collection, as the spec example needs. The HL7 Java engine evaluates it once instead, like its other arguments, with the `$this` where the call is written rather than the input of `trace()` (`funcTrace()` in `FHIRPathEngine.java`, [hapifhir/org.hl7.fhir.core](https://github.com/hapifhir/org.hl7.fhir.core)); the suite cannot tell the two apart, because it only counts the returned input. The projection is evaluated whether or not there is a hook, so adding a hook never changes a result or an error.
  - `name` is a String parameter with [singleton evaluation](#singleton-evaluation-uses-implicit-conversions-only): more than one item raises `eval/singleton-expected`, a non-String `eval/type-mismatch`. An empty `name` traces under the name `''`: empty propagation would make the result empty, and `trace()` never changes its input.
  - The hook is a host boundary ([ADR-0004](adr/0004-sync-core-async-path.md)): `evaluateAsync()` waits for a promise it returns before going on, and `evaluate()` raises `eval/async-in-sync` for one. This extends the `void` return of the [T0021 sketch](tasks/T0021-hooks-async.md#host-hooks) ([#185](https://github.com/losol/callis/issues/185)).
- **Code:** `traceFunction` in `packages/core/src/functions/utility.ts`, and `traceSink()` in `packages/core/src/api/compile.ts` ([T0017](tasks/T0017-fn-tree-utility.md)).

## Equality and ordering

Implemented in `packages/core/src/runtime/` (`equality.ts`, `comparison.ts`, `operands.ts`; [T0009](tasks/T0009-equality-kernels.md)).

### Model-less date convenience

- **Spec:** none. This is a Callis extension. [N1 §5.5](https://hl7.org/fhirpath/N1/#conversion) has no implicit String → date/time conversion, and [N1 §6.1.1](https://hl7.org/fhirpath/N1/#equals) and [§6.2](https://hl7.org/fhirpath/N1/#comparison) need operands of the same type. Without a model, plain JSON has no date type, so `birthDate = @1974-12-25` would always be false ([T0003](tasks/T0003-types-and-collections.md#type-system), [#55](https://github.com/losol/callis/issues/55)).
- **Tests:** no suite test covers model-less input. Direct tests in `operands.test.ts`.
- **Decision:** only when no model is supplied, a string from untyped input data is read as a date/time when the other operand of `=`, `!=`, `~`, `!~`, `<`, `<=`, `>` or `>=` is one, in either operand order:
  - Eligible: an input node with no model type whose JSON value is a string. String literals and computed strings never are, and neither is any node when a model is supplied, even if the model does not know the node's type.
  - Against a Date or DateTime, text without a `T` is parsed as a Date (`parseDate()`) and text with one as a DateTime (`parseDateTime()`); against a Time, as a Time (`parseTime()`). The usual temporal rules follow: partial precision, Date → DateTime, offsets and the evaluation's default offset. So `birthDate < @2000` is true, and `=` between the input text `1974-12` and `@1974-12-25` is empty.
  - Text that does not parse stays a String: `=` gives `false` and `<` raises `eval/type-mismatch`, as for any String against a date. It never raises `eval/invalid-literal`. Two input strings compare as strings.
  - The node is not changed and nothing is cached on it, so later String operations on it are unaffected.

### Equivalent collections pair their items one to one

- **Spec:** [N1 §6.1.2](https://hl7.org/fhirpath/N1/#equivalent) says "each item must be equivalent" and that the comparison "is not order dependent", but not whether one item may match several. Equivalence is not transitive: decimals round to the less precise operand, so `1 ~ 1.2` and `1 ~ 1.4` are true but `1.2 ~ 1.4` is false.
- **Tests:** `testEquivalent20`, `testEquivalent21`, `testEquivalent23`, `testEquivalent24` and their `testNotEquivalent` counterparts.
- **Decision:** two collections are equivalent when they have the same length and some ordering of one is pairwise equivalent to the other, so each item is used once. `(1 | 1 | 2) ~ (1 | 2 | 2)` is false, and `(1 | 1.2) ~ (1.2 | 1.4)` is true even though pairing `1` with the first equivalent item (`1.2`) would leave `1.2` and `1.4`.

### Complex values without a model

- **Spec:** [N1 §6.1.1](https://hl7.org/fhirpath/N1/#equals) and [§6.1.2](https://hl7.org/fhirpath/N1/#equivalent) compare complex types by "all child properties", recursively, but plain JSON has no type definition that lists them.
- **Tests:** `testEquality25`–`27`, `testEquivalent19`–`21` (with the FHIR model; [FHIR equivalence](#fhir-equivalence) refines `~` for FHIR types).
- **Decision:** the child properties are what model-less navigation sees: own properties only, arrays flattened, and `null`, an empty array and a missing property all mean "no value". The order of the properties does not matter. Each child collection is compared with `=` (repeating items in order) or `~` (in any order), so child strings compare exactly or case-insensitively and child numbers by value. Two input strings are never read as dates.
- **With a model:** two typed nodes of the same model type compare by their elements instead of their JSON keys, so a choice element compares by its one value, a FHIR `date` by the date rules, and `_name` extensions and keys that are not elements are ignored. Typed nodes of different model types are not equal and not equivalent, as N1 requires operands of the same type: a `Patient` and a `Practitioner` with the same `id` differ, so `|` keeps both. A node the model does not know keeps the JSON rules, also against a typed node. FHIR Quantities without a UCUM code have [their own rule](#fhir-quantities-without-a-ucum-code), and `~` on FHIR types follows [FHIR equivalence](#fhir-equivalence). (T0018)

## Subsetting and combining

Implemented in `packages/core/src/functions/subsetting.ts` and `combining.ts` ([T0013](tasks/T0013-fn-subsetting-combining.md)).

### `skip()` and `take()` with an empty count

- **Spec:** [N1 §5.3.6](https://hl7.org/fhirpath/N1/#skipnum-integer-collection) gives the input back for a `num` of zero or less, and [§5.3.7](https://hl7.org/fhirpath/N1/#takenum-integer-collection) gives empty for a `num` of zero or less. Neither says what an empty `num` does, or what a `num` that is not an Integer does.
- **Tests:** `testSkip7`, `testSkip8`, `testTake8` and `testTake9` ("`skip()` with an empty count returns empty"); `testSkip5` and `testSkip6` for the counts of zero or less.
- **Decision:** an empty `num` gives empty, for `skip()` as well as for `take()`, before the rule for counts of zero or less is considered, so `(0 | 1 | 2).skip({})` is empty and not the input. `num` goes through [singleton evaluation](#singleton-evaluation-uses-implicit-conversions-only) whether or not the input is empty, as the arguments of the [string functions](#substring-and-the-checks-on-string-functions) do: more than one item raises `eval/singleton-expected`, and a single item that is not an Integer (`'1'`, `1.5`, `1.0`, `true`) raises `eval/type-mismatch`, because nothing converts to Integer implicitly. So an error never depends on the data.
- **Code:** `skipFunction` and `takeFunction` in `packages/core/src/functions/subsetting.ts`.

### `intersect()` and `exclude()` with undetermined equality

- **Spec:** [N1 §5.3.8](https://hl7.org/fhirpath/N1/#intersectother-collection-collection) and [§5.3.9](https://hl7.org/fhirpath/N1/#excludeother-collection-collection) take "the elements that are in both collections" and "that are not in the other collection". [N1 §6.1.1](https://hl7.org/fhirpath/N1/#equals) lets `=` be empty, for example for date/times of different precision, and [`union()`](https://hl7.org/fhirpath/N1/#unionother-collection) says it uses `=` "to determine equality". None of them says what an empty comparison means for membership.
- **Tests:** `testIntersect1`–`4` and `testExclude1`–`4`; none compares values whose equality is undetermined.
- **Decision:** an item is in the other collection only when `=` is `true` for one of its items. An undetermined comparison does not establish equality, as in the `|` operator ([T0010](tasks/T0010-operators.md)): `@2020-01.intersect(@2020)` is empty, `@2020-01.exclude(@2020)` keeps `@2020-01`, and `@2020-01.union(@2020)` has both items. `intersect()` and `exclude()` compare with the same kernel as `|`, `in` and `contains`, so they inherit the [model-less date convenience](#model-less-date-convenience) and the rule that typed nodes of different model types are never equal.
- **Code:** `includesEqual()` in `packages/core/src/functions/subsetting.ts`.

### The order and the items of `intersect()`, `union()` and `combine()`

- **Spec:** [N1 §5.3.8](https://hl7.org/fhirpath/N1/#intersectother-collection-collection) says the order of `intersect()` is "not guaranteed to be preserved", and [§5.4.1](https://hl7.org/fhirpath/N1/#unionother-collection) and [§5.4.2](https://hl7.org/fhirpath/N1/#combineother-collection-collection) say there is "no expectation of order" in the result of `union()` and `combine()`. `intersect()` and `union()` eliminate duplicates, so the spec does not say which of two equal items remains. It calls `a.union(b)` "synonymous with `a | b`".
- **Tests:** `testIntersect4`, `testUnion2`, `testUnion8` and `testUnion13` (counts only); `testCombine2` and `testCombine3` expect the given names before the family names, the order `combine()` keeps. The `preserveOrder` argument of `combine()` is STU ([T0027](tasks/T0027-stu-collections.md)).
- **Decision:** the results have an order that never varies:
  - `intersect()` lists each item once, in the order of the input; the item is the input's, not the equal one of the argument.
  - `union()` is the `|` operator: the items of the input, then the new items of the argument, each at its first position. Of equal items the first remains, so a node of the input keeps its model type and its model-less date provenance.
  - `combine()` lists the input, then the argument, keeping every duplicate. The signature takes the one argument `other` until T0027 adds the optional `preserveOrder`.
  - `exclude()` keeps the order and the duplicates of the input, as the spec requires.
- **Code:** `intersectFunction` in `packages/core/src/functions/subsetting.ts`; `unionFunction` and `combineFunction` in `packages/core/src/functions/combining.ts`.

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

### Characters are Unicode scalar values

- **Spec:** [N1 §5.6](https://hl7.org/fhirpath/N1/#string-manipulation) does not say what a "character" is. [3.0.0](https://hl7.org/fhirpath/STU3/en/#string-manipulation) measures `indexOf()`, `substring()`, `length()` and `toChars()` in characters, "Unicode scalar values", and its examples count a surrogate pair as one (`'a🔥b'.indexOf('b')` is `2`) and a combining accent as one more (`'é'.length()` is `2`).
- **Tests:** none in the suite. `testMatchesUnicodeCharacters` is commented out in the XML.
- **Decision:** follow 3.0.0 and count code points, not UTF-16 code units. `indexOf()`, `substring()`, `length()` and `toChars()` convert between characters and JavaScript's code units, and `toChars()` never splits a surrogate pair. Grapheme clusters are not used, as 3.0.0 says.
- **Strings that are not well-formed:** an expression cannot write a lone surrogate ([the lexer rejects it](#escaped-surrogates-must-form-a-pair)), but input data can hold one. Each lone surrogate counts as one character, and a search never matches half of a surrogate pair: `'🔥'.startsWith('\uD83D')` is false, and `'🔥'.replace('\uD83D', 'x')` is `'🔥'`. This applies to `indexOf()`, `startsWith()`, `endsWith()`, `contains()` and `replace()`.
- **Case:** `upper()` and `lower()` use JavaScript's `toUpperCase()` and `toLowerCase()`, the Unicode default case mapping with no locale, so `'ß'.upper()` is `'SS'` (as in [string equivalence](#string-equivalence)).
- **Code:** `packages/core/src/functions/characters.ts` ([T0015](tasks/T0015-fn-string.md)).

### Regular expressions use JavaScript's dialect

- **Spec:** [N1 §5.6.9–10](https://hl7.org/fhirpath/N1/#matchesregex-string-boolean) ask for expressions that are case-sensitive, in "single line" mode, with Unicode characters, and do not prescribe a dialect; they only recommend the PCRE flavor.
- **Tests:** `testMatchesCaseSensitive1`–`2`, `testMatchesSingleLineMode1`, `testMatchesWithinUrl1`–`4`, `testReplaceMatches1`–`7`.
- **Decision:** `matches()` and `replaceMatches()` use `RegExp` with the `u` and `s` flags. The `u` flag reads the text as characters and allows `\p{…}`. The `s` flag is "single line" mode, as `testMatchesSingleLineMode1` shows: `.` also matches a line terminator. `^` and `$` match only at the ends of the string, so `matches()` finds the expression anywhere in the input and `'^…$'` matches all of it (`testMatchesWithinUrl2`–`3`). Lines are not special; the `m` flag is a 3.0.0 addition ([T0029](tasks/T0029-stu-strings.md)). A pattern is compiled on every call, so no state is kept between evaluations.
- **Differences from PCRE** that a user can run into: `\d`, `\w`, `\s` and `\b` follow JavaScript (`\d` and `\w` are ASCII only, `\s` is Unicode); the `u` flag allows an escape only for a syntax character, so `\-` outside a character class and `\_` are errors; there are no inline flags (`(?i)`), possessive quantifiers, atomic groups, `\A`, `\Z` or `(?P<name>…)` (a named group is `(?<name>…)`).
- **Error code:** a pattern that is not valid raises `eval/invalid-argument`. There is no new error code: the argument is the problem.
- **Not covered:** a pattern can take exponential time on some input (catastrophic backtracking), as in every backtracking engine. The [architecture](architecture.md#security-and-robustness) documents this, and the `regex` hook for a safe engine comes with [T0021](tasks/T0021-hooks-async.md); every pattern is compiled by `compileRegex()`, the one place for it to plug in.
- **Errors:** the message says why a pattern is not valid but does not repeat the pattern, because a pattern can be computed from input data and errors never include input data ([architecture](architecture.md#security-and-robustness)).
- **Code:** `packages/core/src/functions/regex.ts` ([T0015](tasks/T0015-fn-string.md)).

### The substitution of `replaceMatches()`

- **Spec:** [N1 §5.6.10](https://hl7.org/fhirpath/N1/#replacematchesregex-string-substitution-string-string): "The substitution may refer to identified match groups in the regular expression", with the example `'${day}-${month}-${year}'` for named groups. It does not say how a reference is written beyond the example. (The N1 example calls `replace(…)`; it means `replaceMatches(…)`.)
- **Tests:** none in the suite uses a group.
- **Decision:** the substitution is expanded by Callis, so it does not depend on `String.prototype.replace`. It accepts the spec's `${name}` and `${n}` (`${0}` is the whole match) and JavaScript's replacement patterns: `$1`–`$99`, `$<name>`, `` $& ``, `` $` ``, `$'` and `$$`. A group that took no part in the match is the empty string. As in JavaScript, `$n` without a group `n` is plain text, so `'costs $5'` is safe; use `$$` for a dollar sign before `{` or a digit. A `${…}` reference to a group the pattern does not have raises `eval/invalid-argument`, like Java does; it is raised when a match is replaced, so a text with no match never raises it. Supporting both forms now means no expression changes meaning when one of them is added later.
- **Code:** `expandSubstitution()` in `packages/core/src/functions/regex.ts` ([T0015](tasks/T0015-fn-string.md)).

### An empty pattern in `replace()` and `replaceMatches()`

- **Spec:** [N1 §5.6.8](https://hl7.org/fhirpath/N1/#replacepattern-string-substitution-string-string) says an empty `pattern` surrounds every character with the substitution (`'abc'.replace('', 'x')` is `'xaxbxcx'`). `replaceMatches()` says nothing about an empty `regex`.
- **Tests:** `testReplace2` (`'abc'.replace('', 'x')` is `'xaxbxcx'`) and `testReplaceMatches2` (`'abc'.replaceMatches('', 'x')` is `'abc'`).
- **Decision:** follow both tests. `replace()` treats the pattern as text, so the empty string occurs before every character and at the end; `''.replace('', 'x')` is `'x'`. `replaceMatches()` returns the input unchanged for an empty `regex`, although the regular expression `''` matches everywhere. Any other expression that can match nothing, such as `x*`, replaces its empty matches as the engine finds them: `'abc'.replaceMatches('x*', '-')` is `'-a-b-c-'`, and with the `u` flag a match never falls inside a surrogate pair.

### `substring()` and the checks on string functions

- **Spec:** [N1 §5.6.2](https://hl7.org/fhirpath/N1/#substringstart-integer-length-integer-string) says "If `start` lies outside the length of the string, the function returns empty"; [3.0.0](https://hl7.org/fhirpath/STU3/en/#substringstart--integer--length--integer--string) adds "outside, or equal to", and that a `length` of zero or less gives `''`. [N1 §5.6](https://hl7.org/fhirpath/N1/#string-manipulation) says the functions "operate on collections with a single item" and signal an error for more than one item "or an item that is not a String". The specs do not say whether an invalid argument is an error when the input is empty.
- **Tests:** `testSubstring4`–`5`, `testSubstring9`, `testSubstring13`–`18`, `testStartsWithNonString1`, `testEndsWithNonString1`, `testContainsNonString1`.
- **Decision:**
  - A `start` at the end of the string is outside it: `'abc'.substring(3)` and `''.substring(0)` are empty (3.0.0). `start` is checked before `length`: `'abc'.substring(-1, -1)` and `'abc'.substring(3, 0)` are empty, while `'abc'.substring(2, 0)` is `''`.
  - The input and every argument go through [singleton evaluation](#singleton-evaluation-uses-implicit-conversions-only) whether or not another one is empty. `{}.startsWith(1)` raises `eval/type-mismatch` and `'a'.substring(0 | 1)` raises `eval/singleton-expected`, so an error does not depend on the data. Only after that is an empty input or argument an empty result. A String argument is a String only: `'abc'.substring('1')` and `'abc'.substring(1.5)` are errors, since nothing converts to Integer implicitly.
  - The `NonString` tests (`Appointment.identifier.startsWith('rand')`) are `invalid="semantic"`. The error is found during evaluation, so the runner reports them as "detected late" ([Semantic errors found during evaluation](#semantic-errors-found-during-evaluation)) until [T0024](tasks/T0024-static-analysis.md).
  - An argument is evaluated with the focus of the call ([Function arguments](#function-arguments-are-evaluated-with-the-focus-of-the-call)), which is why `testSubstring10a` and `testStartsWith12a` are errors: `length()` there is the length of the root resource.

## Date, DateTime and Time

Implemented in `packages/core/src/values/datetime/` ([T0005](tasks/T0005-date-time.md)).

### A value without a timezone offset is UTC

- **Spec:** [N1 Date/Time equality](https://hl7.org/fhirpath/N1/#datetime-equality) leaves the default offset for values without one to the implementation.
- **Tests:** `testEquality23` (`@2012-04-15T15:00:00Z = @2012-04-15T10:00:00`) and `testNEquality17` (the same with `!=`) expect empty. The suite notes that the result "could be impacted by the timezone of the engine running the test".
- **Decision:** The owner chose UTC as the default ([ADR-0012](adr/0012-evaluation-defaults.md)). The value without an offset is read as 10:00Z, so the results are `false` and `true`, and these two tests fail. No fixed default offset gives empty; that would need a policy where a missing offset is unknown (anywhere within ±14:00). The owner kept UTC (#50), so both tests are conformance exceptions in the R4 and R5 reports (`tools/conformance/src/exceptions.ts`).

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
- **R4 suite:** the R4 copy of the suite (`tests-fhir-r4.xml`) still expects `testPlusDate19` to ignore the fraction (`@1973-12-25T00:00:00.000+10:00 + 0.1 's'` unchanged). Callis follows the R5 copy, which is the source of truth and matches 3.0.0, so the R4 `testPlusDate19` is a conformance exception (`tools/conformance/src/exceptions.ts`, #51). The R5 test runs as usual.

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

### `ordered` and `checkOrderedFunctions`

- **Spec:** [N1 §3.1](https://hl7.org/fhirpath/N1/#collections) says the order of `children()` and `descendants()` is undefined, and that implementations *may* report an error for an order-dependent operation on such a collection. `testSchema.xsd` documents `ordered` as "check order of results".
- **Tests:** `testDollarOrderNotAllowed` expects a semantic error for `Patient.children().skip(1)`. R4 marks it `checkOrderedFunctions="true"` and R5 `ordered="true"`; both copies are `mode="strict"`.
- **Decision:** `ordered` only controls how outputs are compared: in order, or as a multiset when `ordered="false"`. `checkOrderedFunctions` is not passed to the engine. The test is in strict mode, so `strict` is the signal, as in the HL7 Java runner, which ignores the attribute. Whether strict mode reports order-dependent operations on unordered collections is up to [T0024](tasks/T0024-static-analysis.md).

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

### Features that later tasks add

- **Spec:** none; this is how the runner reports an engine that is still being built ([ADR-0011](adr/0011-conformance-suite.md)).
- **Tests:** every test that calls a spec function or uses a FHIR variable that the engine does not have yet. For example `testDollarOrderNotAllowed` (`children()`, `skip()`) and `testSubSetOf3` (`where()`, `subsetOf()`).
- **Decision:** such a test fails as "not implemented", whatever it expects. Without this rule a test that expects a semantic or execution error would pass because the function is unknown, and would fail again once the feature exists. The engine adapter checks the parsed expression for functions of the spec that later tasks own and the registry does not have yet. It also classifies `eval/undefined-variable` for a FHIR variable that T0032 defines as not implemented. These checks retire themselves as the features arrive. The functions that only answer through a host hook (`memberOf`, `subsumes`, `subsumedBy`, `conformsTo`, `htmlChecks`) are registered since T0020 and return empty without one; until [T0021](tasks/T0021-hooks-async.md) passes fake hooks to the evaluation, a test that calls one is not implemented either, rather than a wrong result. T0010 removes the temporary operator code `eval/not-implemented`, its compiler stub and its classifier branch (#104). A genuinely unknown function or variable, which no task adds, is still a semantic or execution error.
- **Code:** `checkImplemented()` and `classifyError()` in `tools/conformance/src/engine-adapter.ts`.

### Converting the XML inputs

- **Spec:** [FHIR XML](https://hl7.org/fhir/R4/xml.html) and [FHIR JSON](https://hl7.org/fhir/R4/json.html) ([R5 JSON](https://hl7.org/fhir/R5/json.html#primitive)) define the two formats, and [XML 1.0](https://www.w3.org/TR/xml/) how XML is read. They do not say how the narrative XHTML is written as a JSON string.
- **Tests:** every test with an XML input. The ten inputs that copy an official FHIR example are compared with its official JSON (`tools/conformance/src/official-examples.ts`).
- **Decision** ([T0023](tasks/T0023-xml-fixture-conversion.md), [`tools/conformance`](../tools/conformance/README.md#converted-xml-inputs)):
  - The narrative `div` is copied from the XML as written, with its whitespace and references (`&#39;` stays `&#39;`). The official JSON examples write the XHTML anew, which changes whitespace and references but not the XHTML. `htmlTest01`, the one test that reads a narrative, uses `patient-example.xml`, whose narrative is the same either way.
  - Attribute values are read as [XML 1.0 §3.3.3](https://www.w3.org/TR/xml/#AVNormalize) requires: a line break written inside a `value` attribute is a space, and the indentation after it is kept (`description` in `codesystem-example.xml`).
  - `decimal` and `integer` values keep their XML text as JSON numbers (`1.50`, `9.5e2`, `1.5E2`), because FHIRPath can see the precision. A value that is not also a JSON number (a leading `+`) is refused rather than rewritten; none of the inputs has one.
  - R5 `integer64` is a JSON string, as R5 JSON requires. XML comments are dropped; FHIR JSON has none.
  - `ccda.xml` is a CDA document, not FHIR, and is not converted. Only the out-of-scope `cdaTests` group uses it.

### Duplicate test names

- **Tests:** the R4 file has two tests named `testEquivalent23` (R5 renamed the second to `testEquivalent24`).
- **Decision:** test IDs are the names, made unique with a `#2`, `#3`, … suffix in document order. The second R4 test is `testEquivalent23#2` in reports and in the baseline.

## FHIR functions

Implemented in `packages/core/src/fhir/` ([T0020](tasks/T0020-fhir-functions.md)). R4, R5 and the R6 draft define these functions and variables the same way, so there is no version-specific code.

### `%resource` and `%rootResource`

- **Spec:** [R5 §2.1.9.1.4](https://hl7.org/fhir/R5/fhirpath.html#variables): `%resource` is "the resource that contains the original node that is in `%context`", and `%rootResource` "the container resource for the resource identified by `%resource`"; [§2.1.9.1.7](https://hl7.org/fhir/R5/fhirpath.html#vars) adds "Do not go past a root resource into a bundle". The same in [R4](https://hl7.org/fhir/R4/fhirpath.html#variables) and the [R6 draft §2.1.9.2](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#variables). Neither says what they are when `%context` is part of no resource.
- **Tests:** `isGuardAndOtherImplies`, `isGuardOtherAndImplies` and `isGuardOrInnerImplies` (`%resource` with a `context`), `testMultipleResolve`, `htmlTest02`–`04`; the `testDollarResource` group is commented out in both suites. Direct tests in `fhir/variables.test.ts` and `test/generated-models.test.ts`.
- **Decision:** both follow the parent chain of the input nodes, so an input node selected by an earlier evaluation, as the conformance runner's `context` does, still belongs to its resource:
  - `%resource` is, for each item of `%context`, the nearest node, the item itself or an ancestor, whose JSON has a `resourceType`. An item that is part of no resource, such as a data type passed on its own, is used as it is, so `%resource` is never undefined. A resource reached from several items is listed once.
  - `%rootResource` is, for each item of `%resource`, the resource that contains it through `contained`, and otherwise the item itself. A resource in a `Bundle` entry is not contained, so the walk never enters the Bundle. FHIR forbids contained resources inside contained resources; should the data nest them anyway, it is the outermost container.
  - The evaluation options `resource` and `rootResource` override them, as the [T0038 sketch](tasks/T0038-public-api-completion.md#public-api-sketch) has it. A value is converted like a variable value, typed by the model; `null` and `[]` make the variable empty. Without its own value, `%rootResource` is derived from `%resource`, the default one or the host's.
  - A host variable of the same name hides them, and `%sct`, `%loinc`, `` %`vs-[name]` `` and `` %`ext-[name]` `` too, so a host that defined `%resource` as a variable before T0020 keeps its value; only `%context` and `%ucum` cannot be redefined. Such a variable is only a value: `%rootResource` is still derived from the `resource` option or the input. A `vs-` or `ext-` without a name is not defined (`eval/undefined-variable`).
- **Code:** `createFhirEnvironment()` in `packages/core/src/fhir/variables.ts`.

### `hasValue()` is always a Boolean

- **Spec:** [R5 §2.1.9.1.5](https://hl7.org/fhir/R5/fhirpath.html#functions) and [R4](https://hl7.org/fhir/R4/fhirpath.html#functions): true "if the input collection contains a single value which is a FHIR primitive, and it has a primitive value … Otherwise, the return value is empty." The [R6 draft §2.1.9.3.2](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#functions) gives false for a single primitive without a value and keeps empty for anything that is not a single FHIR primitive.
- **Tests:** `testHasCodingValue1`–`3` (R4 and R5): `name.first().hasValue()`, a `HumanName`, expects false. `testNoValueHasValue` and `testPrimitiveExtensions` (R5) expect false for a primitive with only extensions.
- **Decision:** follow the suites ([ADR-0001](adr/0001-spec-baseline.md), [ADR-0011](adr/0011-conformance-suite.md)), as the HL7 Java engine does (`funcHasValue()` in `FHIRPathEngine.java` gives false for anything but one item with a primitive value): `hasValue()` is true for a single item whose System value is a Boolean, String, Integer, Long, Decimal, Date, DateTime or Time, and false for anything else: a primitive with only extensions, a complex value, a Quantity, empty input or several items. Without a model, a JSON primitive counts as a primitive, and so does a System value such as a literal. `getValue()` gives that value where `hasValue()` is true and is empty otherwise, as all three versions say. No suite exceptions.
- **Code:** `hasValueFunction` and `getValueFunction` in `packages/core/src/fhir/functions.ts`.

### Local references in `resolve()`

- **Spec:** [R5 §2.1.9.1.5](https://hl7.org/fhir/R5/fhirpath.html#functions) resolves a string or a `Reference` "if it is a string that is a uri (or canonical or url)", and ignores what does not resolve; the [R6 draft](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#functions) leaves the protocols to the engine. How references point into a Bundle is in [Bundle references](https://hl7.org/fhir/R5/bundle.html#references): a URN or an absolute reference matches an entry's `fullUrl`, a version is split off and matched against `meta.versionId`, and a relative `Type/id` is made absolute with the RESTful base of the `fullUrl` of the entry it is in; without such a base, and in Bundles without `fullUrl`s, "resolution expectations are undefined". Contained references are in [References](https://hl7.org/fhir/R5/references.html#contained).
- **Tests:** `testMultipleResolve` (R5); direct tests in `fhir/resolve.test.ts`, including inputs with several resources or Bundles, and a Bundle with the same `Type/id` on two servers, and `test/generated-models.test.ts`.
- **Decision:** without a host hook ([T0021](tasks/T0021-hooks-async.md#host-hooks)), `resolve()` finds what is in the data:
  - A String or a FHIR primitive is the reference; a `Reference` gives its `reference`, and without a model any object with a string `reference` does. With a model, a typed value of another type is not a reference.
  - `#id` is the contained resource with that `id` of the reference's own root resource: the container of the resource the reference is part of ([`%rootResource`](#resource-and-rootresource) for that resource), so a reference in a Bundle entry finds the contained resources of that entry, and each resource of an input with several resources finds its own. `%rootResource` is used instead for an item that is part of no resource, such as a String literal, where the first of its resources that has the id wins, and for an item in `%resource` when the host's `%rootResource` does not hold its container, so the `rootResource` option applies to a contained resource evaluated on its own. `#` alone is that root resource, as FHIR allows a contained resource to refer to its container.
  - Any other reference is looked up in the nearest `Bundle` around the item, or, for an item that is part of no resource, around each resource of `%rootResource` in turn, following the Bundle rules: a URN or an absolute reference matches the first entry with that `fullUrl`, and a relative `Type/id` is made absolute with the RESTful base of the `fullUrl` of the entry the item is in, even when another server's entry has the same type and id; a target missing on that server does not resolve. A version, `/_history/[version]`, is removed before matching and must equal the resource's `meta.versionId`. Where the spec leaves a relative reference undefined, because its entry has no RESTful `fullUrl` (a `urn:uuid:` one, or none) or the item is in no entry, Callis matches the first entry whose resource has that type and id, as the suites' Bundles and many documents expect.
  - The result is the node that navigation gives for the resource, typed the same way and with the same parent chain: `'#x'.resolve()` and `contained.where(id = 'x')` are the same node. A contained resource of a type the model does not know is typed as the declared `Resource` ([T0018](tasks/T0018-model-aware-evaluation.md#navigation-rules)), so an R6-only `DeviceAlert` is a `DeviceAlert` under R6 and a `Resource` under R4 and R5.
- **Code:** `resolveFunction` in `packages/core/src/fhir/resolve.ts`.

### FHIR equivalence

- **Spec:** [R5 §2.1.9.1.6](https://hl7.org/fhir/R5/fhirpath.html#changes), the same in [R4](https://hl7.org/fhir/R4/fhirpath.html#changes) and the [R6 draft §2.1.9.5.1](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#changes): for complex types `~` requires "all child properties to be equal, except for "id" elements"; a `Coding` is compared on `code` and `system` only; two `CodeableConcept`s are equivalent when "any Coding in one is equivalent to any Coding in the other".
- **Tests:** none in the suites (the HL7 Java engine has no such rule either); direct tests in `fhir/equivalence.test.ts` and `test/generated-models.test.ts`.
- **Decision:** for two nodes of the same FHIR model type, `~` compares the elements with `~`, so the children of a complex value compare by equivalence, as [N1 §6.1.2](https://hl7.org/fhirpath/N1/#equivalent) does, and nested values follow the same rules:
  - Every element named `id` is ignored, `Resource.id` included.
  - A `Coding` compares `system` and `code` with `~`, so case and whitespace in a code are ignored like in any other string; `version`, `display`, `userSelected` and the other elements are ignored. Two codings with neither are equivalent.
  - A `CodeableConcept` is equivalent to another when a coding of one is equivalent to a coding of the other. One without codings is equivalent to none, whatever its `text`, not even to itself: the rules apply before the kernels' shortcut for two nodes holding the same JSON object, so `code ~ code` on a text-only concept is false, as it is for two copies, and so is `~` between two nodes of one resource that holds such a concept.
  - `=` is unchanged and compares every element. Untyped data and other models keep the default rule.
- **Code:** `fhirEquivalence` in `packages/core/src/fhir/equivalence.ts`, through the `modelEquivalence` extension point of `runtime/equality.ts` ([T0009](tasks/T0009-equality-kernels.md)).

### `htmlChecks()` on strings

- **Spec:** the R4 and R5 texts define `htmlChecks()` on an xhtml element only, with no value for any other kind of element ([R4](https://hl7.org/fhir/R4/fhirpath.html#functions), [R5 §2.1.9.1.5](https://hl7.org/fhir/R5/fhirpath.html#fn-htmlChecks)). The R6 draft adds strings: a string is parsed as the content of a `div`, and the result is false when it does not parse or breaks the HTML rules ([6.0.0-snapshot1 §2.1.9.3.12](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#fn-htmlChecks), FHIR-56303).
- **Tests:** R5 `HTMLChecks` at [`cb4eac4`](../tools/conformance/fixtures/SOURCE.md): `htmlTest02` (`valueString` with valid HTML, expects true) and `htmlTest03` (`valueString` with a `button`, expects false), both on `parameters-example-html.json`; `htmlTest04` (`valueInteger`) expects empty. R4 has no `HTMLChecks` group.
- **Decision** (owner, 2026-11-08): follow the suite and the R6 draft for every provider (R4, R5 and R6). A string is forwarded to the `htmlChecks` hook like xhtml; any other input gives empty, and without a hook the result is empty. No suite exceptions are registered: [ADR-0001](adr/0001-spec-baseline.md) and [ADR-0011](adr/0011-conformance-suite.md) make the suite the arbiter where it clarifies the rules.
- **Ownership:** [T0021](tasks/T0021-hooks-async.md#owner-decision-htmlchecks-on-strings) implements it and adds the code reference here.

## Parser

### Reserved `div` in an HTML fixture

- **Spec:** [N1 identifiers](https://hl7.org/fhirpath/N1/#identifiers), [N1 grammar](https://hl7.org/fhirpath/N1/grammar.html) (`identifier` and `multiplicativeExpression`), and [3.0.0 grammar](https://hl7.org/fhirpath/STU3/en/grammar.html). `div` is reserved; N1 permits only `as`, `contains`, `in` and `is` as keyword-identifiers. The 3.0.0 rule additionally permits `asc`, `desc` and `sort`, but does not add `div`.
- **Test:** R5 `htmlTest01`: `text.div.htmlChecks()` (group `HTMLChecks`).
- **Decision:** this one expression is an explicit parse-only suite/grammar mismatch. It raises `FhirPathSyntaxError`; `text.\`div\`.htmlChecks()` parses. The acceptance test asserts both outcomes and does not count the original expression as a passing parse. No compatibility extension, fixture edit or conformance-baseline change is made.

### Function arity is not a grammar error

- **Spec:** [N1 function invocations](https://hl7.org/fhirpath/N1/#function-invocations) and [grammar](https://hl7.org/fhirpath/N1/grammar.html) (`function` and `paramList`) allow any syntactically valid argument list. Function resolution and arity checks belong to the compiler (T0008).
- **Tests:** R5 `testSection13`, `testEntry12`, `testSameSubject16`, `testHasCoding10`, all in the out-of-scope `documentFunctions` group, mark well-formed extension calls `invalid="syntax"`.
- **Decision:** those calls parse successfully. They remain excluded from parse-only suite acceptance by group, and separate regression tests assert that parsing does not check function signatures.

## Quantity

### Calendar and definite month factors

- **Spec:** [3.0.0 time-valued conversions](https://hl7.org/fhirpath/STU3/en/index.html#time-valued-unit-conversions) gives calendar month = 30 days, definite UCUM `mo` = 30.4375 days, and `a` = 365.25 days. The older [FHIR R5 mapping discussion](https://hl7.org/fhir/R5/fhirpath.html#quantity) calls `mo` 30 days.
- **Tests:** `quantity time table`, `uses calendar factors explicitly and requires explicit conversion before addition`, and `quantity and datetime calendar consistency`.
- **Decision:** use the 3.0.0 definite factors. Calendar year/month stay distinct from definite durations for equality and ordering; equivalence permits the specified counterparts. Calendar-to-calendar conversion uses 12 months/year, 365 days/year or 30 days/month directly, not a transitive chain through UCUM. Addition/subtraction require explicit conversion when calendar year/month units differ. FHIR mapping follows R5's six-code table; `wk`/`ms` remain UCUM spellings. (T0006)

### Ordering calendar years and months

- **Spec:** [3.0.0 comparison](https://hl7.org/fhirpath/STU3/en/index.html#comparison) explicitly gives `6 months > 1 year` as `false` after converting to years. [Quantity equality](https://hl7.org/fhirpath/STU3/en/index.html#quantity-equality) requires time comparison in the least granular unit while retaining each code system.
- **Pinned suites:** FHIR/fhir-test-cases commit `cb4eac4` (see `tools/conformance/fixtures/source.json`), both R4 and R5: `testLessThan29` (`1 year < 2 months`), `testGreaterThan29` (`1 year > 2 months`) and `testLessOrEqual28` (`1 year <= 2 days`) all expect empty.
- **Decision:** follow 3.0.0 ([ADR-0001](adr/0001-spec-baseline.md)): its comparison section gives `6 months > 1 year` as `false` after converting to years, so those expressions return `false`, `true` and `false`, respectively. Calendar-to-calendar year/month ordering is supported; calendar year/month against definite UCUM counterparts remains empty. The six suite cases are narrowly enumerated conformance exceptions (#88). Direct kernel tests cover these results and reverse operand orders. (T0006)

### FHIR Quantities without a UCUM code

- **Spec:** [R5 §2.1.9.1.3](https://hl7.org/fhir/R5/fhirpath.html#quantity) converts a FHIR `Quantity` to `System.Quantity` only when it has a UCUM `system` and `code`. For any other Quantity, [N1 §6.1.1](https://hl7.org/fhirpath/N1/#equals) would compare the children, so a unit on one side only would make `=` false.
- **Tests:** group `testQuantityUnitComparison`: `testQuantityUnitVsNoUnitEqual` and `testQuantityNoUnitVsUnitEqual` expect empty, and the matching equivalence tests expect `false`. `testLessThan33`, `testLessOrEqual30` and `testGreaterThan30` (`parameters-quantity-unit-text`) order a quantity with only unit text against a UCUM-coded one with the same unit text by value ([#150](https://github.com/losol/callis/issues/150)).
- **Decision:** two FHIR Quantities (or specializations such as `Age`) of which at least one does not convert compare by their elements, close to how the HL7 Java engine orders them (`sameUnit()` in `FHIRPathEngine.java`). Their units match when both have a `code` and the codes are the same. When only one has a `code`, both must have a `unit` text and the texts must be the same, as for the suite's `mg/dL` pair: a UCUM-coded `5 mg` without unit text against `5` without a code or unit has no unit in common, so `=` is empty, where the Java engine's missing-equals-missing would make it true. When neither has a `code`, the `unit` texts must be the same, and two quantities with neither a code nor a unit match. The rule is the same for `=`, `~`, `<`, `<=`, `>` and `>=`, so the operators agree with each other; the Java engine's equality is stricter when only one has a code, which would make `=` empty where `<` and `>` are both false. When the units do not match, `=` and the ordering operators are empty and `~` is false, as for quantities whose units cannot be related. Otherwise the values compare as Decimals, without unit conversion: two quantities without a value are equal, and a missing value makes `=` and ordering empty and `~` false. Two FHIR Quantities that both convert compare as System Quantities, with unit conversion. A FHIR Quantity that does not convert is still a complex value against a System Quantity such as a literal: `=` is false and ordering raises `eval/type-mismatch`, as [N1 §6.2](https://hl7.org/fhirpath/N1/#comparison) requires for operands of different types. The `comparator` element (`<`, `<=`, `>=`, `>`, `ad`) is ignored in every case, as the R5 mapping and the HL7 Java engine ignore it, so `<5 mg` compares as `5 mg`; the spec defines no meaning for a comparator in FHIRPath operations. (T0018, T0020)
- **Code:** `fhirQuantityPair()` in `packages/core/src/runtime/fhir-quantity.ts`, used by `equality.ts` and `comparison.ts`.

### Equivalence of unsupported or incompatible quantities

- **Spec:** [N1 equivalence](https://hl7.org/fhirpath/N1/#equivalent) says "Attempting to operate on quantities with invalid units will result in `false`". [3.0.0 Quantity Equivalence](https://hl7.org/fhirpath/STU3/en/index.html#quantity-equivalence) is inconsistent here and says empty; [FHIR-59626](https://jira.hl7.org/browse/FHIR-59626) ("Quantity equivalence returns false rather than empty for invalid or incomparable units") corrects it in the next release.
- **Tests:** R4 `testEquivalent28` and R5 `testEquivalent29` (`1 'x' ~ 1 year`); R4 `testEquivalent29` and R5 `testEquivalent30` (`1 year ~ 1 'kg'`) all expect `false`.
- **Decision:** `~` returns `false` when the units cannot be related or the conversion overflows, following N1, the suite and the FHIR-59626 resolution. Equality and ordering keep returning empty for such units (T0006 acceptance criterion). No conformance exception is needed. Direct kernel tests cover both operand orders. (T0006)

### Recurring time conversion precision

- **Spec:** [3.0.0 Quantity Equality](https://hl7.org/fhirpath/STU3/en/index.html#quantity-equality) requires the least granular time unit, preserving each operand's code system. [Unit conversions](https://hl7.org/fhirpath/STU3/en/index.html#unit-conversions) warns against premature rounding; a recurring fraction cannot be represented exactly by a finite Decimal.
- **Tests:** direct regression `compares recurring time ratios without rounding distinct values to equality`, using `0.01666666666666666666666666667 'min'` versus `1 's'` in both operand orders; no pinned-suite counterpart.
- **Decision:** terminating conversion ratios preserve all representable digits; recurring ratios use the Decimal kernel's 28-significant-digit division. Exact equality and ordering must not consume rounded conversion intermediates. The optional provider comparison capability uses exact ratio cross-products; the minimal provider implements it. Both operand orders distinguish the slightly different values in this regression, as well as `1 'min'` versus `(60 + 10^-28) 's'`. Explicit conversions and equivalence still use the Decimal conversion result. (T0006)

### UCUM unit algebra

- **Spec:** [3.0.0 multiplication](https://hl7.org/fhirpath/STU3/en/index.html#multiplication) and [division](https://hl7.org/fhirpath/STU3/en/index.html#division) ask for "an appropriate unit as determined by application of the [UCUM] specification" and give examples (`12 'cm' * 3 'cm'` is `36 'cm2'`, `10 'm/s' * 10 's'` is `100 'm'`, `60 / 1 's'` is `60 '/s'`), but [UCUM](https://ucum.org/ucum#section-Semantics) defines no canonical spelling. The suite only checks results with `=`, which accepts any commensurable unit (`2.0 'cm' * 2.0 'm' = 0.040 'm2'`).
- **Tests:** `testQuantity9`–`testQuantity11`; in `packages/ucum/test/ucum-quantity.test.ts`, the multiplication and division rows of `FHIRPath 3.0.0 examples`, the `unit algebra` table, and `returns units whose magnitude times the scale equals the exact product or quotient`.
- **Decision:** `@callis/ucum` keeps the simple units as written, in order. Identical simple units add their exponents (`'cm2' / 'cm'` is `'cm'`). A later simple unit with the same dimension as an earlier one that has not cancelled out is converted into it with an exact factor, so `'m/s' * 'min'` is `60 'm'`, `2.0 'cm' * 2.0 'm'` is `400.00 'cm2'`, and `'cm' / 'm'` is `0.01 '1'`. Dimensionless and arbitrary units only combine with identical ones. Integer factors move into the numeric factor, and annotations are dropped, because they carry no meaning ([UCUM §12](https://ucum.org/ucum#section-Style)). Multiplying or dividing by `'1'` keeps the other unit as written. Special units such as `Cel` take part in no product or quotient, not even with `'1'` ([UCUM §22](https://ucum.org/ucum#section-Special-Units-on-non-ratio-Scales)). A product or quotient whose unit the provider would not accept again (its magnitude needs more than 4,096 bits) is empty. (T0007)

### Arbitrary and special UCUM units

- **Spec:** [UCUM §24 and §25](https://ucum.org/ucum#section-Arbitrary-Units): an arbitrary unit such as `[iU]` is commensurable with no other unit, and "any term involving arbitrary units … is not comparable with any other arbitrary unit or term". [UCUM §21–23](https://ucum.org/ucum#section-Special-Units-on-non-ratio-Scales) define special units by conversion functions; [3.0.0 quantity equality](https://hl7.org/fhirpath/STU3/en/index.html#quantity-equality) has `23 'Cel' = 73.4 '[degF]'` as `true`.
- **Tests:** `only matches arbitrary units with the identical unit (UCUM §24, §25)`, `does not convert special units other than Cel and [degF]` and the `Cel`/`[degF]` rows of `FHIRPath 3.0.0 examples`.
- **Decision:** quantities with arbitrary units only compare or convert when their units are spelled identically: `1 '[iU]' = 1 '[IU]'` and `1 '[iU]/mL' = 1000 '[iU]/L'` are empty, and `~` is `false`. Of the 21 special units of the essence file, `Cel` and `[degF]` convert, on their offset scales, when written alone (an annotation is allowed). Prefixed, raised or compound uses (`mCel`, `Cel/s`) and the other special units are valid but not convertible; identical spellings still compare. (T0007)

### Calendar keywords and other UCUM time units

- **Spec:** the [3.0.0 time-valued quantities](https://hl7.org/fhirpath/STU3/#time-valued-quantities) table relates calendar keywords only to `'a'`, `'mo'`, `'wk'`, `'d'`, `'h'`, `'min'`, `'s'` and `'ms'`. UCUM has more time units (`us`, `a_j`, `mo_g`, …).
- **Tests:** the `calendar keywords` group in `packages/ucum/test/ucum-quantity.test.ts`, which also checks every pair of minimal units against `minimalUnitSystem`.
- **Decision:** when both units are ones the minimal unit system knows (`'1'`, calendar keywords and the eight UCUM time units), `@callis/ucum` gives exactly its result. Against other UCUM time units, `week` to `millisecond` stand for their definite counterpart, and `year` and `month` only for equivalence: `1 week = 604800000000 'us'` is `true`, `1 year = 31557600000000 'us'` is empty and `1 year ~ 31557600000000 'us'` is `true`. An explicit conversion to a calendar keyword converts to its UCUM counterpart and relabels (`1 'a_j'` becomes `1 year`). An explicit conversion from `year` or `month` to a UCUM unit outside the table is empty, because that unit has no calendar counterpart to relabel to. (T0007)

### Exponents after integers in UCUM

- **Spec:** the [UCUM grammar](https://ucum.org/ucum#section-Syntax-Rules) allows no exponent on an integer (`<factor> ::= <digits>`), but §9 says "2+10 means 2^10 = 1024".
- **Tests:** `parses 2+10` and `parses 10-3` in `packages/ucum/src/expression/unit-expression.test.ts`.
- **Decision:** follow §9: an integer followed by a signed exponent is raised to that power. An unsigned exponent cannot occur, because a run of digits is one integer (§8). (T0007)

## Operators

### Undetermined equality in union and membership

- **Spec:** [N1 union](https://hl7.org/fhirpath/N1/#union-collections), [membership](https://hl7.org/fhirpath/N1/#in-membership) and [containership](https://hl7.org/fhirpath/N1/#contains-containership) use equality semantics but do not explicitly specify how an undetermined item comparison affects these operators.
- **Tests:** `collection operators` in `packages/core/test/operators.test.ts`, including `@2020 in @2020-01` and a later definite match after an undetermined comparison. The pinned suite has no such case.
- **Decision:** only a `true` equality establishes a duplicate or a membership match. Union retains items with undetermined equality; membership returns `false` when no item definitely matches. A later definite match returns `true`. This keeps union’s result a collection and membership’s nonempty search result Boolean, as their definitions require. The original retained item keeps its input provenance.

### Incorrect result comments in N1 ordering examples

- **Spec:** [N1 less or equal](https://hl7.org/fhirpath/N1/#less-or-equal) and [greater or equal](https://hl7.org/fhirpath/N1/#greater-or-equal) define the usual ordering but reverse the result comments for `10 <= 5`, `10 <= 5.0`, `'abc' <= 'ABC'`, and their `>=` counterparts.
- **Tests:** `ordering operators` in `packages/core/test/operators.test.ts` tests all four operators for each N1 operand pair. The pinned `testLessOrEqual`/`testGreatorOrEqual` groups also exercise numeric/String ordering.
- **Decision:** follow the operator definitions: `10 <= 5` and `'abc' <= 'ABC'` are false; their `>=` counterparts are true. String order remains Unicode code point order, through the T0009 kernel.

### Filtering criteria use the canonical singleton Boolean rule

- **Spec:** [N1 where](https://hl7.org/fhirpath/N1/#wherecriteria-expression-collection) and [3.0.0 where](https://hl7.org/fhirpath/STU3/en/index.html#wherecriteria--this-index--boolean--collection) require a single Boolean condition, but also refer to [singleton evaluation](https://hl7.org/fhirpath/N1/#singleton-evaluation-of-collections), whose second step treats any other single item in a Boolean context as true.
- **Tests:** `where through the public synchronous API` in `packages/core/src/functions/filtering.test.ts` covers true, false, empty, zero, empty String, `'false'`, Decimal, Date and Quantity criteria, and multi-item errors. The pinned `testWhere` group has no non-Boolean criterion case.
- **Decision:** follow T0003's established Boolean-context contract and the existing `singleton(result, 'Boolean', asBoolean)` helper. Single non-Boolean criteria match; they are not explicitly converted and no JavaScript truthiness rule is used. False/empty does not match. Multiple items raise `eval/singleton-expected`. This preserves the canonical rule already documented for where and the owner-approved narrowed T0012 contract; it does not change operators or other Boolean consumers.

### Existence criteria stop after the first match

- **Spec:** [N1 exists](https://hl7.org/fhirpath/N1/#existscriteria-expression-boolean) describes the optional criterion as shorthand for `where(criteria).exists()`, but does not explicitly require evaluating later criteria after a match.
- **Tests:** `short-circuits on a match without evaluating a later invalid or failing item` and the internal sync/promise/custom-thenable/cross-realm cases in `packages/core/src/functions/existence.test.ts`; the pinned `testExists` group has no later-error case.
- **Decision:** the owner-approved narrowed T0011 contract stops at the first match. Later criteria are not evaluated, including errors they would have raised. A criterion reached before a match still propagates its error; no match gives false. The predicate conversion itself is exactly T0012's canonical helper. This differs from materializing every item through where before asking exists when a later criterion fails, and does not change where's sequential evaluation of all items.

## Conversion

### Scope of the `iif()` arguments

- **Spec:** [N1 iif()](https://hl7.org/fhirpath/N1/#iifcriterion-expression-true-result-collection-otherwise-result-collection-collection) does not say what the focus and `$this` of its arguments are. [3.0.0 iif()](https://hl7.org/fhirpath/STU3/en/index.html#iifcriterion-this--boolean-true-result-this--collection--otherwise-result-this--collection--collection) makes it a scoped function: the criterion and the selected branch are evaluated with `$this` set to the input, the criterion also when the input is empty, `$index` is not set, so it keeps the value of an outer function, and more than one input item is an error.
- **Tests:** `testIif7`–`testIif11` and `testCollectionBoolean1`–`6`; `iif` in `packages/core/src/functions/conversion.test.ts`, with the 3.0.0 examples.
- **Decision:** follow 3.0.0. The input is the focus and `$this` of all three arguments, also when it is empty, so `{}.iif(exists(), 'yes', 'no')` is `'no'` and `Patient.birthDate.iif(true, $this)` is empty without a birth date. Without a target the input is the focus where the call is written. `$index` and `$total` are those of the enclosing function. More than one input item raises `eval/singleton-expected` before the criterion is evaluated. The criterion follows singleton evaluation, as in `where()` ([above](#filtering-criteria-use-the-canonical-singleton-boolean-rule)): a single non-Boolean item counts as true, as the 3.0.0 examples `iif(0, 'true', 'false')` and `iif('hi', 'true', 'false')` show. `testIif6` is `mode="strict"` and expects a semantic error for a String criterion; that is static analysis ([T0024](tasks/T0024-static-analysis.md)).
- **Code:** `iifFunction` in `packages/core/src/functions/conversion.ts`, through `LambdaArg.forInput()` (`functions/define.ts`, `compiler/lambda.ts`).

### `toString()` of a FHIR Quantity

- **Spec:** [N1 toString()](https://hl7.org/fhirpath/N1/#tostring-string) converts a Quantity, and [R5](https://hl7.org/fhir/R5/fhirpath.html#quantity) maps a FHIR `Quantity` with a UCUM code to `System.Quantity`. The R6 draft adds a FHIR override, [§2.1.9.4.1](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#fn-toString): `toString()` gives a String only for a FHIR primitive that has a value and a System type, and is empty otherwise. A FHIR `Quantity` is a complex type, so under that note `Observation.value.toString()` is empty.
- **Tests:** `converts a FHIR Quantity with a UCUM code as a System Quantity, with every provider` and `gives empty for a primitive that has only extensions` in `packages/core/test/conversion-models.test.ts`, run against the `r4`, `r5` and `r6` providers.
- **Decision:** the engine behaves the same with every provider ([FHIR versions](roadmap.md#fhir-versions)). A FHIR `Quantity` with a UCUM code is a System Quantity ([T0018](tasks/T0018-model-aware-evaluation.md#modelnode)), so `toString()` writes it (`185.50 '[lb_av]'`) and `convertsToString()` is true, also with the R6 provider. This differs from the R6 draft. A FHIR `Quantity` without a UCUM code is not a System Quantity, so `toString()` and `toQuantity()` are empty for it, as the R6 note has it. For primitives the R6 note and Callis agree: a primitive with only extensions has no value, and every conversion function gives empty for it, `convertsToX()` included. Revisit when R6 is final.

### Calendar keywords in `toString()`

- **Spec:** [3.0.0 toString()](https://hl7.org/fhirpath/STU3/en/index.html#tostring--string) writes UCUM units quoted and calendar keywords without quotes, and gives `(4 days).toString()` as `4 days`. N1 only gives the format `(\+|-)?\d+(.\d+)? '.*'`.
- **Tests:** `testQuantityLiteralWkToString` (`1 'wk'`), `testQuantityLiteralWeekToString` (`1 week`); `toString and convertsToString` in `packages/core/src/functions/conversion.test.ts`.
- **Decision:** a Quantity keeps no spelling of its calendar keyword, so `4 days` and `4 day` are the same value ([T0006](tasks/T0006-quantity.md)). `toString()` writes the keyword in the singular: `(4 days).toString()` is `'4 day'`, not the `'4 days'` of the 3.0.0 example. Both are valid quantity literals, and `toQuantity()` reads both back to the same value.

### Quantity strings and the unit argument of `toQuantity()`

- **Spec:** [N1 toQuantity()](https://hl7.org/fhirpath/N1/#toquantityunit-string-quantity) gives the string format `(?'value'(\+|-)?\d+(\.\d+)?)\s*('(?'unit'[^']+)'|(?'time'[a-zA-Z]+))?` and says that with a unit argument the result is true or false. [3.0.0](https://hl7.org/fhirpath/STU3/en/index.html#toquantityunit--string--quantity) corrects that: the result is the converted quantity, or empty. Neither says whether the format must match the whole string, whether the unquoted word must be a calendar keyword, or what an empty unit argument means.
- **Tests:** `testStringQuantityWeekConvertsToQuantityFalse` (`'1 wk'`), `testStringDecimalLiteralConvertsToQuantityFalse` (`'1.a'`) and the other `toQuantity` tests of `testTypes`; `toQuantity and convertsToQuantity` in `packages/core/src/functions/conversion.test.ts` and `packages/ucum/test/conversion-integration.test.ts`.
- **Decision:** the format must match the whole string, and an unquoted word must be a calendar keyword in lower case, singular or plural, so `'1 wk'` and `'1 Day'` do not convert. A quoted unit is taken as written, without asking the unit system, as in a quantity literal: `'5 \'foo\''` is `5 'foo'`. A unit argument converts the quantity with the unit system as an explicit conversion ([3.0.0 time-valued unit conversions](https://hl7.org/fhirpath/STU3/en/index.html#time-valued-unit-conversions)), so `7 days.toQuantity('wk')` is `1 'wk'`; units that cannot be related give empty, and `false` for `convertsToQuantity()`. The unit must be a single String. An empty unit argument converts nothing, as an empty optional argument of `substring()` is ignored in 3.0.0.
- **Code:** `toQuantityFunction` and `convertsToQuantityFunction` in `packages/core/src/functions/conversion.ts`.
