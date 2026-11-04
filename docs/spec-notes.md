# Specification notes

Interpretations of the FHIRPath specification that are not obvious from its text, and HL7 test-suite labels that Callis deliberately does not follow. Each entry links the spec, names the suite tests involved, and records the decision and the task that made it. The baseline is described in [ADR-0001](adr/0001-spec-baseline.md), and the role of the suite in [ADR-0011](adr/0011-conformance-suite.md).

## Lexer

### Unknown escape sequences are syntax errors

- **Spec:** [N1 §4.1.2](https://hl7.org/fhirpath/N1/#string) lists the escapes `\'`, `\"`, `` \` ``, `\r`, `\n`, `\t`, `\f`, `\\` and `\uXXXX`, and says that "if a `\` is used at the beginning of a non-escape sequence, it will be ignored": `'\p'` is `'p'`, `'\u005'` is `'u005'`, and `'\'` is `''`. [3.0.0](https://hl7.org/fhirpath/STU3/#string) repeats the rule. The grammar's `ESC` rule also allows `\/`; the N1 grammar lacks `\"`, which the 3.0.0 grammar adds.
- **Suite:** `testLiteralUnicodeInvalid` expects `'\u+041'` to be a syntax error, which contradicts the rule. `testLiteralStringEscapes` uses `\'` as an escaped quote, which contradicts `'\'` being `''`.
- **Decision:** follow the suite and [T0001](tasks/T0001-lexer.md). The escapes listed above and `\/` are recognized; any other sequence that starts with `\` raises `syntax/invalid-escape`, and `'\'` is an unterminated string. This applies to strings, delimited identifiers and quoted environment variable names. (T0001)

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
- **Decision:** `%` and its name form one `EnvironmentVariable` token, so nothing may come between them (`% ucum` is an error). The double-quoted form is accepted as a compatibility extension, with the same escapes as strings. A `"` anywhere else is an unexpected character. (T0001)
