import { describe, expect, it } from 'vitest';
import {
  booleanEquals,
  booleanEquivalent,
  compareIntegers,
  compareStrings,
  integerEquals,
  integerEquivalent,
  normalizeStringForEquivalence,
  stringEquals,
  stringEquivalent,
} from './string.ts';

// https://hl7.org/fhirpath/N1/#equals
describe('stringEquals', () => {
  it.each([
    ['a', 'a', true], // testEquality: 'a' = 'a'
    ['a', 'A', false], // case-sensitive
    ['a', 'b', false],
    ['a b', 'a  b', false],
    ['', '', true],
  ])('%j = %j is %s', (left, right, expected) => {
    expect(stringEquals(left, right)).toBe(expected);
  });
});

// https://hl7.org/fhirpath/N1/#string-equivalence, as clarified in FHIRPath 3.0.0
describe('stringEquivalent', () => {
  it.each([
    ['a', 'a', true], // testEquivalent5
    ['a', 'A', true], // testEquivalent6
    ['a', 'b', false], // testEquivalent7
    ['Peter James', 'PETER JAMES', true],
    ['', '', true],
  ])('ignores case: %j ~ %j is %s', (left, right, expected) => {
    expect(stringEquivalent(left, right)).toBe(expected);
  });

  it.each([
    ['a\tb'],
    ['a\nb'],
    ['a\rb'],
    ['a\u000bb'], // vertical tab
    ['a\fb'],
    ['a\u0085b'], // next line (NEL)
    ['a b'], // no-break space
    ['a b'], // em space
    ['a b'], // line separator
    ['a　b'], // ideographic space
  ])('treats every Unicode whitespace character as a space: %j ~ "a b"', (left) => {
    expect(stringEquivalent(left, 'a b')).toBe(true);
  });

  it('does not treat a zero-width no-break space (BOM) as whitespace', () => {
    // U+FEFF matches \s in JavaScript but is not in the Unicode White_Space property.
    expect(stringEquivalent('a﻿b', 'a b')).toBe(false);
  });

  it.each([
    ['a  b', 'a b'],
    ['a\t\tb', 'a b'],
  ])('does not collapse runs of whitespace: %j ~ %j is false', (left, right) => {
    expect(stringEquivalent(left, right)).toBe(false);
  });

  it('matches runs of whitespace of the same length', () => {
    expect(stringEquivalent('a \t b', 'a\n \rb')).toBe(true);
  });

  it.each([
    [' a', 'a'],
    ['a ', 'a'],
  ])('does not trim: %j ~ %j is false', (left, right) => {
    expect(stringEquivalent(left, right)).toBe(false);
  });

  it.each([
    ['Straße', 'STRASSE'], // full case folding: ß is ss
    ['σ', 'ς'], // final sigma folds to sigma
    ['ΣΑΣ', 'σας'],
    ['I', 'i'], // no Turkish locale rules
    ['ǅ', 'ǆ'], // title case
  ])('folds case without locale rules: %j ~ %j', (left, right) => {
    expect(stringEquivalent(left, right)).toBe(true);
  });

  it('does not apply Unicode normalization', () => {
    // é as one code point against e followed by a combining acute accent
    expect(stringEquivalent('é', 'é')).toBe(false);
  });
});

describe('normalizeStringForEquivalence', () => {
  it('gives equal results exactly for equivalent strings', () => {
    expect(normalizeStringForEquivalence('A\tB')).toBe(normalizeStringForEquivalence('a b'));
    expect(normalizeStringForEquivalence('A\tB')).toBe('a b');
  });

  it('does not change the input', () => {
    const input = 'A\tB';
    normalizeStringForEquivalence(input);
    expect(input).toBe('A\tB');
  });
});

// https://hl7.org/fhirpath/N1/#comparison: "String ordering is strictly lexical and is based on
// the Unicode value of the individual characters."
describe('compareStrings', () => {
  it.each([
    ['a', 'b', -1],
    ['b', 'a', 1],
    ['abc', 'abc', 0],
    ['', '', 0],
    ['a', 'ab', -1], // a prefix comes first
    ['ab', 'a', 1],
    ['', 'a', -1],
    ['B', 'a', -1], // upper case letters have lower code points
    ['a', 'B', 1],
    ['abc', 'abd', -1],
  ])('compares %j with %j as %i', (left, right, expected) => {
    expect(compareStrings(left, right)).toBe(expected);
  });

  it('orders characters above U+FFFF by code point, not by UTF-16 code unit', () => {
    const ffff = '￿';
    const linearB = '\u{10000}'; // stored as the surrogate pair D800 DC00
    expect(ffff < linearB).toBe(false); // JavaScript compares code units
    expect(compareStrings(ffff, linearB)).toBe(-1);
    expect(compareStrings(linearB, ffff)).toBe(1);
    expect(compareStrings('', '\u{1f600}')).toBe(-1);
  });

  it('orders two characters above U+FFFF by code point', () => {
    expect(compareStrings('\u{1f600}', '\u{1f601}')).toBe(-1); // same high surrogate
    expect(compareStrings('\u{10400}', '\u{1f600}')).toBe(-1); // different high surrogates
    expect(compareStrings('\u{1f600}', '\u{10400}')).toBe(1);
  });

  it('orders a BMP character below U+D800 before a character above U+FFFF', () => {
    expect(compareStrings('퟿', '\u{10000}')).toBe(-1);
  });
});

describe('Integer kernels', () => {
  it.each([
    [1, 1, true],
    [1, 2, false],
    [0, -0, true],
    [-2147483648, -2147483648, true],
  ])('%i = %i is %s, and so is ~', (left, right, expected) => {
    expect(integerEquals(left, right)).toBe(expected);
    expect(integerEquivalent(left, right)).toBe(expected);
  });

  it.each([
    [1, 2, -1],
    [2, 1, 1],
    [3, 3, 0],
    [-1, 0, -1],
    [-2147483648, 2147483647, -1],
  ])('compares %i with %i as %i', (left, right, expected) => {
    expect(compareIntegers(left, right)).toBe(expected);
  });
});

describe('Boolean kernels', () => {
  it.each([
    [true, true, true],
    [false, false, true],
    [true, false, false],
    [false, true, false],
  ])('%s = %s is %s, and so is ~', (left, right, expected) => {
    expect(booleanEquals(left, right)).toBe(expected);
    expect(booleanEquivalent(left, right)).toBe(expected);
  });
});
