/**
 * Operators and punctuation. Each kind is spelled like its source text.
 *
 * @see https://hl7.org/fhirpath/N1/#symbols
 */
export type SymbolKind =
  | '('
  | ')'
  | '['
  | ']'
  | '{'
  | '}'
  | '.'
  | ','
  | '='
  | '!='
  | '~'
  | '!~'
  | '<'
  | '<='
  | '>'
  | '>='
  | '+'
  | '-'
  | '*'
  | '/'
  | '|'
  | '&';

/**
 * Whitespace and comments. The lexer only returns them when `includeTrivia` is set.
 *
 * @see https://hl7.org/fhirpath/N1/#whitespace
 * @see https://hl7.org/fhirpath/N1/#comments
 */
export type TriviaKind = 'Whitespace' | 'LineComment' | 'BlockComment';

/**
 * The kind of a {@link Token}.
 *
 * - `Identifier`: a simple identifier such as `name` or `_id`. Keywords (`and`, `div`, `true`,
 *   `year`, …) are identifiers too; the parser decides what they mean.
 * - `DelimitedIdentifier`: an identifier in backticks, such as `` `div` ``.
 * - `String`, `Number`, `Date`, `DateTime`, `Time`: literals. Quantities are a `Number` followed by
 *   a `String` or a calendar keyword, and are built by the parser.
 * - `EnvironmentVariable`: `%` and the variable name, as one token.
 * - `$this`, `$index`, `$total`: the special variables.
 * - `EOF`: the end of the input. Always the last token.
 */
export type TokenKind =
  | 'Identifier'
  | 'DelimitedIdentifier'
  | 'String'
  | 'Number'
  | 'Date'
  | 'DateTime'
  | 'Time'
  | 'EnvironmentVariable'
  | '$this'
  | '$index'
  | '$total'
  | SymbolKind
  | TriviaKind
  | 'EOF';

/**
 * A token: its kind, where it is, and its value.
 *
 * `start` and `end` are offsets into the expression in UTF-16 code units, and `end` is exclusive,
 * so the token's source text is `expression.slice(start, end)`. Line and column are not stored;
 * compute them with a `LineTable` when they are needed, for example for an error.
 */
export interface Token {
  readonly kind: TokenKind;
  readonly start: number;
  readonly end: number;
  /**
   * What the token stands for:
   *
   * - `String`: the text between the quotes, with escapes decoded.
   * - `DelimitedIdentifier`: the name between the backticks, with escapes decoded.
   * - `EnvironmentVariable`: the name without `%` and without quotes or backticks, with escapes
   *   decoded. `%ucum`, `` %`ucum` `` and `%'ucum'` all have the value `ucum`.
   * - `EOF`: the empty string.
   * - Every other kind: the source text, for example `1.50`, `@2015-02-04` or `<=`.
   */
  readonly value: string;
}
