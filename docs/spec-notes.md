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
