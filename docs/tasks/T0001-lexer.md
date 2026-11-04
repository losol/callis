# T0001 — Lexer

Part of the [roadmap](../roadmap.md). Phase 1 · wave 1 · size M.

- **Depends on:** [T0000](T0000-scaffold.md)
- **Parallel with:** [T0003](T0003-types-and-collections.md), [T0004](T0004-decimal.md), [T0005](T0005-date-time.md), [T0022](T0022-conformance-runner.md)
- **Conformance groups:** `comments` (with T0002)
- **Background:** [ADR-0002](../adr/0002-hand-written-parser.md)

## Goal

Turn an expression string into tokens with exact source spans, as described in the [design notes](#design-notes) below.

## Scope

- `src/lexer/`: token kinds (`token.ts`), the lexer (`lexer.ts`), character-code constants (`char-codes.ts`), and a line table for line/column lookup (`line-table.ts`).
- Identifiers, delimited identifiers, strings with all escapes, numbers (including the `1.toString()` rule), date/time literals (`@2015`, `@2015-02-04T14:34:28+09:00`, `@2015T`, `@T14:30:14.559`), symbols and operators, `$this`/`$index`/`$total`, and `%` followed by an identifier, a delimited identifier or a string. The double-quoted `%"…"` form is accepted for compatibility.
- Comments and whitespace, plus an `includeTrivia` option.
- Error codes `syntax/unterminated-string`, `syntax/unterminated-comment`, `syntax/invalid-escape`, `syntax/unexpected-character` and `syntax/invalid-date-literal` (shape only). A timezone on a `TIME` literal (`@T14:34:28Z`) is accepted as part of the token; the compiler rejects it at evaluation (T0008).

## Design notes

The lexer is hand-written ([ADR-0002](../adr/0002-hand-written-parser.md)). It makes one pass over the UTF-16 string, switching on character codes; the hot path has no regular expressions.

- **Tokens** carry `kind`, `start` and `end` offsets, and a `value` (see [token API](#token-api)). Line and column are computed lazily from a line table, only when an error is formatted.
- **Trivia:** whitespace, `//` line comments and `/* */` block comments are skipped. An `includeTrivia` option keeps them for tooling.
- **Identifiers:** simple identifiers (`[A-Za-z_][A-Za-z0-9_]*`) and delimited identifiers in backticks, which support the same escapes as strings ([N1 §8.6](https://hl7.org/fhirpath/N1/#identifiers)).
- **Keywords** are lexed as identifiers, and the parser decides what they mean. This is because `as`, `contains`, `in` and `is` are also legal identifiers, while `div`, `mod`, `and` and the others are reserved ([N1 §8.5](https://hl7.org/fhirpath/N1/#keywords)). Calendar unit keywords (`year`, `months`, …) work the same way.
- **Strings:** single quotes, with escapes `\'`, `\"`, `` \` ``, `\\`, `\/`, `\f`, `\n`, `\r`, `\t` and `\uXXXX` ([N1 §4.1.2](https://hl7.org/fhirpath/N1/#string)). Any other escape is `syntax/invalid-escape`. N1 says the backslash of an unknown sequence is ignored, but the suite rejects `'\u+041'`, and Callis follows the suite ([spec notes](../spec-notes.md#unknown-escape-sequences-are-syntax-errors)). An escaped surrogate must be part of a pair, as 3.0.0 requires ([spec notes](../spec-notes.md#escaped-surrogates-must-form-a-pair)). Unescaped line breaks are allowed, as in the grammar.
- **Numbers:** `[0-9]+('.'[0-9]+)?`. Leading zeros are allowed. A `.` that is not followed by a digit ends the number, so `1.toString()` lexes as `1`, `.`, `toString`. The `L` suffix for `Long` (phase 2) is anticipated.
- **Date/time literals:** the `@` forms from the grammar (`DATE`, `DATETIME` including `@2015T`, `TIME` as `@T…`). The lexer checks only the shape. It also tolerates a timezone on a `TIME` literal (`@T14:34:28Z`), which the grammar does not allow, so that the literal can fail at evaluation as the suite expects (see [T0008: invalid literal values](T0008-compiler-evaluator.md#invalid-literal-values)). Range checks (month 13, Feb 30) happen when the compiler builds the literal value. Like the grammar's tokens, a literal is the longest prefix with a valid shape, so `@2015-1` is `@2015`, `-`, `1`. A literal directly followed by a digit or `:` (`@2015-01-01T14:3`) is `syntax/invalid-date-literal` ([spec notes](../spec-notes.md#date-and-time-literals-end-at-the-longest-valid-shape)).
- **Symbols:** `( ) [ ] { } . , = != ~ !~ < <= > >= + - * / | &`, and `$this`, `$index` and `$total`. `%` starts an environment variable token.
- **Environment variable names:** after `%` come an identifier, a delimited identifier, or a string (`%'us-zip'`, allowed for backwards compatibility per [N1 §9](https://hl7.org/fhirpath/N1/#environment-variables)). The double-quoted form `%"vs-name"` that appears on the FHIR pages is accepted as a documented compatibility extension. `%` and the name form one `EnvironmentVariable` token, with nothing between them ([spec notes](../spec-notes.md#environment-variables-are-single-tokens)).
- **Errors:** each raises `FhirPathSyntaxError` with a span.

  | Problem | Code |
  | --- | --- |
  | Unterminated string, delimited identifier or quoted variable name | `syntax/unterminated-string` |
  | Unterminated `/*` comment | `syntax/unterminated-comment` |
  | Invalid escape, or an unpaired escaped surrogate | `syntax/invalid-escape` |
  | Unexpected character, `!` without `=` or `~`, `$` without `this`, `index` or `total`, `%` without a name | `syntax/unexpected-character` |
  | Malformed date/time literal | `syntax/invalid-date-literal` |

### Token API

The parser ([T0002](T0002-parser.md)) uses this interface. All of it is internal to `@callis/core`.

```ts
// token.ts
type SymbolKind = '(' | ')' | '[' | ']' | '{' | '}' | '.' | ',' | '=' | '!=' | '~' | '!~'
  | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/' | '|' | '&';
type TriviaKind = 'Whitespace' | 'LineComment' | 'BlockComment';     // only with includeTrivia
type TokenKind = 'Identifier' | 'DelimitedIdentifier' | 'String' | 'Number'
  | 'Date' | 'DateTime' | 'Time' | 'EnvironmentVariable' | '$this' | '$index' | '$total'
  | SymbolKind | TriviaKind | 'EOF';

interface Token {
  readonly kind: TokenKind;
  readonly start: number;   // UTF-16 offset, inclusive
  readonly end: number;     // UTF-16 offset, exclusive
  readonly value: string;
}

// lexer.ts
function tokenize(expression: string, options?: { includeTrivia?: boolean }): readonly Token[];

// line-table.ts
class LineTable {
  constructor(source: string);
  readonly lineCount: number;
  locate(offset: number): { line: number; column: number };   // 1-based
  span(start: number, end?: number): SourceSpan;
}
```

- `tokenize()` returns every token at once and always ends with an `EOF` token at `expression.length`. The parser can look ahead as far as it needs. Because the whole expression is lexed first, a lexical error is reported even when a parse error comes earlier in the text.
- `value` is the decoded text for `String` and `DelimitedIdentifier` (quotes removed, escapes decoded) and the decoded name for `EnvironmentVariable` (`%ucum`, `` %`ucum` ``, `%'ucum'` and `%"ucum"` all have the value `ucum`). For `EOF` it is empty. For every other kind it is the source text, for example `1.50` or `@2015-02-04`, so literals keep their raw text. For a `String` literal, the raw text is `expression.slice(token.start, token.end)` and the decoded text is `value`; the AST should keep the decoded text, so the compiler does not decode escapes a second time.
- Keywords, including `true`, `false`, the operators `and`, `div`, … and the calendar units, are `Identifier` tokens. To reject `%true` or other reserved words after `%`, the parser can check whether the character after `%` is a letter or `_`.
- With `includeTrivia`, the tokens cover the expression without gaps; joining their source text rebuilds it.
- `LineTable` uses the same line breaks as `spanFromOffsets` (`\n`, `\r\n` or a lone `\r`).

## Acceptance criteria

- [x] Every token kind is produced with correct `start`/`end`. Errors report correct line and column.
- [x] All examples in [N1 §8](https://hl7.org/fhirpath/N1/#lexical-elements) and all escapes in [N1 §4.1.2](https://hl7.org/fhirpath/N1/#string) have table-driven tests.
- [x] Edge cases are covered: `1.toString()`, `1.5`, `` `div` ``, unterminated `/*`, `@2015-01-01T`, `@T14`, timezone `Z` and `±hh:mm`.
- [x] A fuzz test (random strings) never crashes; it only produces tokens or `FhirPathSyntaxError`.
- [x] Line coverage of `lexer/` is at least 95%.
