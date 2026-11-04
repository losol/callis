import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/lexer/lexer.ts';
import { DateValue } from '../src/values/datetime/date.ts';
import { DateTimeValue } from '../src/values/datetime/datetime.ts';
import { parseTemporalLiteral } from '../src/values/datetime/parse.ts';
import { TimeValue } from '../src/values/datetime/time.ts';

/** The single date/time token of an expression. */
function literalToken(expression: string): { kind: string; value: string } {
  const tokens = tokenize(expression).filter((token) => token.kind !== 'EOF');
  const [token] = tokens;
  if (tokens.length !== 1 || token === undefined) {
    throw new Error(`Expected one token in test: ${expression}`);
  }
  return token;
}

// The compiler (T0008) builds literal values from the lexer's token text with parseTemporalLiteral.
describe('date/time tokens from the lexer', () => {
  it.each([
    ['@2014-01-25', 'Date', DateValue],
    ['@2014-01', 'Date', DateValue],
    ['@2014', 'Date', DateValue],
    ['@2014-01-25T14:30:14.559+01:00', 'DateTime', DateTimeValue],
    ['@2015-02-04T10Z', 'DateTime', DateTimeValue],
    ['@2014-01T', 'DateTime', DateTimeValue],
    ['@2014T', 'DateTime', DateTimeValue],
    ['@T14:30:14.559', 'Time', TimeValue],
    ['@T14', 'Time', TimeValue],
  ])('parses the %s token (%s) into its value', (expression, kind, type) => {
    const token = literalToken(expression);
    expect(token.kind).toBe(kind);
    const value = parseTemporalLiteral(token.value);
    expect(value).toBeInstanceOf(type);
    expect(value?.toLiteral()).toBe(expression);
  });

  it.each([
    '@2015-02-30', // out-of-range day
    '@2015-13', // month 13
    '@2015-02-04T24:00', // hour 24
    '@T14:34:28Z', // testLiteralTimeUTC: a timezone on a Time
    '@T14:34:28+10:00', // testLiteralTimeTimezoneOffset
    '@2015T10:00', // a time on a year-only date (spec-notes.md)
    '@2015-02T10', // a time on a year-month date
    '@2015-02-04T10:00+14:30', // an offset beyond +14:00
  ])('lexes %s, whose value is then invalid (eval/invalid-literal in T0008)', (expression) => {
    const token = literalToken(expression);
    expect(['Date', 'DateTime', 'Time']).toContain(token.kind);
    expect(parseTemporalLiteral(token.value)).toBeUndefined();
  });
});
