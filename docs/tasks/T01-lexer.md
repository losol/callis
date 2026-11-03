# T1 — Lexer

Part of the [roadmap](../roadmap.md). Phase 1 · wave 1 · size M.

- **Depends on:** [T0](T00-scaffold.md)
- **Parallel with:** [T3](T03-types-and-collections.md), [T4](T04-decimal.md), [T5](T05-date-time.md), [T22](T22-conformance-runner.md)
- **Conformance groups:** `comments` (with T2)
- **Background:** [ADR-0002](../adr/0002-hand-written-parser.md)

## Goal

Turn an expression string into tokens with exact source spans, as described in the [design notes](#design-notes) below.

## Scope

- `src/lexer/`: token kinds, the lexer, character-code constants, and a line table for line/column lookup.
- Identifiers, delimited identifiers, strings with all escapes, numbers (including the `1.toString()` rule), date/time literals (`@2015`, `@2015-02-04T14:34:28+09:00`, `@2015T`, `@T14:30:14.559`), symbols and operators, `$this`/`$index`/`$total`, and `%` followed by an identifier, a delimited identifier or a string. The double-quoted `%"…"` form is accepted for compatibility.
- Comments and whitespace, plus an `includeTrivia` option.
- Error codes `syntax/unterminated-string`, `syntax/invalid-escape`, `syntax/unexpected-character` and `syntax/invalid-date-literal` (shape only). A timezone on a `TIME` literal (`@T14:34:28Z`) is accepted as part of the token; the compiler rejects it at evaluation (T8).

## Design notes

The lexer is hand-written ([ADR-0002](../adr/0002-hand-written-parser.md)). It makes one pass over the UTF-16 string, switching on character codes; the hot path has no regular expressions.

- **Tokens** carry `kind`, `start` and `end` offsets. Line and column are computed lazily from a line table, only when an error is formatted.
- **Trivia:** whitespace, `//` line comments and `/* */` block comments are skipped. An `includeTrivia` option keeps them for tooling.
- **Identifiers:** simple identifiers (`[A-Za-z_][A-Za-z0-9_]*`) and delimited identifiers in backticks, which support the same escapes as strings ([N1 §8.6](https://hl7.org/fhirpath/N1/#identifiers)).
- **Keywords** are lexed as identifiers, and the parser decides what they mean. This is because `as`, `contains`, `in` and `is` are also legal identifiers, while `div`, `mod`, `and` and the others are reserved ([N1 §8.5](https://hl7.org/fhirpath/N1/#keywords)). Calendar unit keywords (`year`, `months`, …) work the same way.
- **Strings:** single quotes, with escapes `\'`, `\"`, `` \` ``, `\\`, `\/`, `\f`, `\n`, `\r`, `\t` and `\uXXXX` ([N1 §4.1.2](https://hl7.org/fhirpath/N1/#string)).
- **Numbers:** `[0-9]+('.'[0-9]+)?`. Leading zeros are allowed. A `.` that is not followed by a digit ends the number, so `1.toString()` lexes as `1`, `.`, `toString`. The `L` suffix for `Long` (phase 2) is anticipated.
- **Date/time literals:** the `@` forms from the grammar (`DATE`, `DATETIME` including `@2015T`, `TIME` as `@T…`). The lexer checks only the shape. It also tolerates a timezone on a `TIME` literal (`@T14:34:28Z`), which the grammar does not allow, so that the literal can fail at evaluation as the suite expects (see [T8: invalid literal values](T08-compiler-evaluator.md#invalid-literal-values)). Range checks (month 13, Feb 30) happen when the compiler builds the literal value.
- **Symbols:** `( ) [ ] { } . , = != ~ !~ < <= > >= + - * / | &`, `$this`, `$index`, `$total` and `%`.
- **Environment variable names:** after `%` come an identifier, a delimited identifier, or a string (`%'us-zip'`, allowed for backwards compatibility per [N1 §9](https://hl7.org/fhirpath/N1/#environment-variables)). The double-quoted form `%"vs-name"` that appears on the FHIR pages is accepted as a documented compatibility extension.
- **Errors:** unterminated string, identifier or comment; invalid escape; unexpected character; malformed date literal. Each raises `FhirPathSyntaxError` with a span.

## Acceptance criteria

- [ ] Every token kind is produced with correct `start`/`end`. Errors report correct line and column.
- [ ] All examples in [N1 §8](https://hl7.org/fhirpath/N1/#lexical-elements) and all escapes in [N1 §4.1.2](https://hl7.org/fhirpath/N1/#string) have table-driven tests.
- [ ] Edge cases are covered: `1.toString()`, `1.5`, `` `div` ``, unterminated `/*`, `@2015-01-01T`, `@T14`, timezone `Z` and `±hh:mm`.
- [ ] A fuzz test (random strings) never crashes; it only produces tokens or `FhirPathSyntaxError`.
- [ ] Line coverage of `lexer/` is at least 95%.
