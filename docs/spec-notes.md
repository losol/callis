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
- **Decision:** `round(n)` rounds half away from zero to `n` decimal places, and a value that already has at most `n` decimal places is returned unchanged: `1.5.round(3)` is `1.5`, not `1.500`. Padding would claim precision the value does not have, and it would let `x.round(2147483647)` allocate a huge number. The .NET implementation behaves the same way; the Java implementation pads.

### Rounding in decimal equivalence

- **Spec:** [N1 §6.1.2](https://hl7.org/fhirpath/N1/#equivalent) compares "values rounded to the precision of the least precise operand" and ignores trailing zeros when determining precision, but does not name the rounding mode.
- **Tests:** `testEquivalent8`–`testEquivalent13`, `testNotEquivalent8`–`testNotEquivalent13`.
- **Decision:** both values are rounded half away from zero, as `round()` does. A consequence of ignoring trailing zeros is that `1.04 ~ 1.0` is `true`: `1.0` counts as precision 0.

### Results that cannot be represented are empty

- **Spec:** [3.0.0 §6.6](https://hl7.org/fhirpath/STU3/#math-1) makes arithmetic overflow and underflow empty; [`power`](https://hl7.org/fhirpath/STU3/#powerexponent--integer--decimal--decimal) and [`sqrt`](https://hl7.org/fhirpath/STU3/#sqrt--decimal) are empty when the result "cannot be represented".
- **Tests:** `testPower3`, `testSqrt2`.
- **Decision:** the Decimal kernels for `sqrt`, `exp`, `ln`, `log` and `power` return empty for `NaN`, infinite results and results that underflow to zero although the exact value is not zero. An exact integer power with more than 10,000 digits is treated as overflow and is also empty; the spec only asks for 28 digits, and the bound keeps the work small. Where 3.0.0 asks for an error instead of empty (for example `log()` of a non-positive number), the function layer ([T0016](tasks/T0016-fn-math.md)) raises it.

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
