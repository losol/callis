import { describe, expect, it } from 'vitest';
import type { ResultItem } from './adapter.ts';
import {
  decimalsEqual,
  formatActual,
  formatExpected,
  itemMatches,
  outputsMatch,
  toPredicate,
} from './compare.ts';
import type { ExpectedOutput, OutputType } from './suite.ts';

const out = (type: OutputType | undefined, text: string): ExpectedOutput => ({ type, text });
const item = (type: string, value?: string, unit?: string): ResultItem => ({
  type,
  ...(value === undefined ? {} : { value }),
  ...(unit === undefined ? {} : { unit }),
});

describe('itemMatches with typed outputs', () => {
  it.each([
    ['boolean', 'true', item('System.Boolean', 'true'), true],
    ['boolean', 'true', item('FHIR.boolean', 'true'), true],
    ['boolean', 'true', item('System.Boolean', 'false'), false],
    ['boolean', 'true', item('System.String', 'true'), false],
    ['integer', '-1', item('System.Integer', '-1'), true],
    ['integer', '5', item('FHIR.positiveInt', '5'), false],
    ['integer', '1', item('System.Decimal', '1'), false],
    ['decimal', '1.50', item('System.Decimal', '1.50'), true],
    ['decimal', '1.50', item('System.Decimal', '1.5'), false],
    ['decimal', '-0.0', item('System.Decimal', '0.0'), true],
    ['decimal', '1', item('System.Integer', '1'), false],
    ['string', 'Peter', item('FHIR.string', 'Peter'), true],
    ['string', 'male', item('FHIR.code', 'male'), false],
    ['string', 'http://x', item('FHIR.uri', 'http://x'), false],
    ['string', ' a ', item('System.String', 'a'), false],
    ['code', 'male', item('FHIR.code', 'male'), true],
    ['code', 'male', item('System.String', 'male'), false],
    ['id', 'c1', item('FHIR.id', 'c1'), true],
    ['date', '@1974-12-25', item('FHIR.date', '1974-12-25'), true],
    ['date', '@1974-12-25', item('System.DateTime', '1974-12-25'), false],
    [
      'dateTime',
      '@2014-01-01T08:00:00.000+14:00',
      item('System.DateTime', '2014-01-01T08:00:00.000+14:00'),
      true,
    ],
    [
      'dateTime',
      '@2014-01-01T08:00:00.000+00:00',
      item('System.DateTime', '2014-01-01T08:00:00.000Z'),
      false,
    ],
    [
      'dateTime',
      '@2014-01-01T08:00:00.000+14:00',
      item('System.DateTime', '2014-01-01T08:00:00+14:00'),
      false,
    ],
    ['dateTime', '@2014', item('FHIR.instant', '2014'), false],
    ['time', '@T10:30:00.000', item('System.Time', '10:30:00.000'), true],
    ['Quantity', "1.58650000 'cm'", item('System.Quantity', '1.58650000', 'cm'), true],
    ['Quantity', "1 '1'", item('System.Quantity', '1', '1'), true],
    ['Quantity', "1.5 'cm'", item('System.Quantity', '1.50', 'cm'), false],
    ['Quantity', "1.5 'cm'", item('System.Quantity', '1.5', 'mm'), false],
    ['Quantity', '4 days', item('System.Quantity', '4', 'days'), true],
    ['Quantity', '4 days', item('FHIR.Duration', '4', 'days'), false],
    ['string', '', item('FHIR.string', 'anything'), true],
    ['string', '', item('FHIR.code', 'x'), false],
    ['string', 'x', item('FHIR.HumanName'), false],
  ] as const)('%s %s vs %o → %s', (type, text, actual, expected) => {
    expect(itemMatches(out(type, text), actual)).toBe(expected);
  });
});

describe('itemMatches with untyped outputs (R4)', () => {
  it.each([
    ['true', item('System.Boolean', 'true'), true],
    ['10.0', item('System.Decimal', '10.0'), true],
    ['10.0', item('System.Decimal', '10'), false],
    ['9', item('System.Integer', '9'), true],
    ['@2014-01', item('System.DateTime', '2014-01'), true],
    ['@2014-01', item('System.Date', '2014-01'), true],
    ['@T10:30:59.999', item('System.Time', '10:30:59.999'), true],
    ["'it\\'s'", item('System.String', "it's"), true],
    ["'a\\nb'", item('System.String', 'a\nb'), true],
    ["1.58750000 'm'", item('System.Quantity', '1.58750000', 'm'), true],
    ['1.0', item('System.String', '1.0'), false],
  ] as const)('%s vs %o → %s', (text, actual, expected) => {
    expect(itemMatches(out(undefined, text), actual)).toBe(expected);
  });
});

describe('decimalsEqual', () => {
  it.each([
    ['1.0', '1.0', true],
    ['01.0', '1.0', true],
    ['+1.0', '1.0', true],
    ['1.0', '1.00', false],
    ['-0', '0', true],
    ['1e3', '1000', false],
  ])('%s = %s → %s', (a, b, expected) => {
    expect(decimalsEqual(a, b)).toBe(expected);
  });
});

describe('outputsMatch', () => {
  const ints = (...values: string[]) => values.map((v) => item('System.Integer', v));
  const expected = [out('integer', '1'), out('integer', '2')];

  it('compares in order by default', () => {
    expect(outputsMatch(expected, ints('1', '2'), true)).toBe(true);
    expect(outputsMatch(expected, ints('2', '1'), true)).toBe(false);
  });

  it('compares as a multiset when ordered="false"', () => {
    expect(outputsMatch(expected, ints('2', '1'), false)).toBe(true);
    expect(outputsMatch(expected, ints('1', '1'), false)).toBe(false);
  });

  it('requires the same number of items', () => {
    expect(outputsMatch([], [], true)).toBe(true);
    expect(outputsMatch([], ints('1'), true)).toBe(false);
    expect(outputsMatch(expected, ints('1', '2', '2'), false)).toBe(false);
  });

  it('finds a pairing that a greedy match would miss', () => {
    // An output with empty text matches any string, so it must not take the only 'a'.
    const outputs = [out('string', ''), out('string', 'a')];
    const actual = [item('System.String', 'a'), item('System.String', 'b')];
    expect(outputsMatch(outputs, actual, false)).toBe(true);
  });
});

describe('toPredicate', () => {
  // predicate="true": a single Boolean is kept, otherwise "is the result not empty".
  it.each([
    [[], 'false'],
    [[item('System.Boolean', 'false')], 'false'],
    [[item('FHIR.boolean', 'true')], 'true'],
    [[item('FHIR.date', '1974-12-25')], 'true'],
    [[item('System.Boolean', 'false'), item('System.Boolean', 'false')], 'true'],
  ])('%o → %s', (actual, value) => {
    expect(toPredicate(actual)).toEqual([{ type: 'System.Boolean', value }]);
  });
});

describe('formatting', () => {
  it('formats expected and actual values the same way', () => {
    expect(formatExpected(out('decimal', '1.50'))).toBe('decimal 1.50');
    expect(formatActual(item('System.Decimal', '1.50'))).toBe('decimal 1.50');
    expect(formatExpected(out('string', 'a b'))).toBe('string "a b"');
    expect(formatActual(item('FHIR.string', 'a b'))).toBe('string "a b"');
    expect(formatExpected(out('time', '@T10:30'))).toBe('time @T10:30');
    expect(formatActual(item('System.Time', '10:30'))).toBe('time @T10:30');
    expect(formatExpected(out('Quantity', "1 'cm'"))).toBe("Quantity 1 'cm'");
    expect(formatActual(item('System.Quantity', '1', 'cm'))).toBe("Quantity 1 'cm'");
    expect(formatExpected(out(undefined, '10.0'))).toBe('10.0 (untyped)');
  });

  it('shows other types with their own name', () => {
    expect(formatActual(item('System.String', 'x'))).toBe('string "x"');
    expect(formatActual(item('FHIR.uri', 'http://x'))).toBe('FHIR.uri http://x');
    expect(formatActual(item('FHIR.HumanName'))).toBe('FHIR.HumanName');
  });
});
