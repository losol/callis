import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  advance,
  characterCount,
  characters,
  endsWithCharacters,
  findFrom,
  isBoundary,
  replaceAllCharacters,
  startsWithCharacters,
} from './characters.ts';

// https://hl7.org/fhirpath/STU3/en/#string-manipulation: a character is a Unicode scalar value.
const FIRE = '\u{1F525}'; // 🔥, one character stored as the pair D83D DD25
const HIGH = '\uD83D';
const LOW = '\uDD25';

/** Any string, including ones with lone surrogates. */
const anyString = fc.string({ unit: 'binary', maxLength: 30 });

describe('characterCount', () => {
  it.each([
    ['', 0],
    ['abc', 3],
    [FIRE, 1],
    [`a${FIRE}b`, 3],
    ['é', 2], // a combining accent is a character of its own
    [HIGH, 1], // a lone surrogate is one character
    [LOW, 1],
    [`${LOW}${HIGH}`, 2], // in the wrong order they are not a pair
    [`${HIGH}${HIGH}${LOW}`, 2],
  ])('counts %j as %i', (text, expected) => {
    expect(characterCount(text)).toBe(expected);
  });

  it('counts the characters before an offset', () => {
    expect(characterCount(`a${FIRE}b`, 1)).toBe(1);
    expect(characterCount(`a${FIRE}b`, 3)).toBe(2);
  });

  it('agrees with the string iterator on any string', () => {
    fc.assert(
      fc.property(anyString, (text) => {
        expect(characterCount(text)).toBe(Array.from(text).length);
      }),
      { numRuns: 200 },
    );
  });
});

describe('advance', () => {
  it('moves by characters, not code units', () => {
    expect(advance(`a${FIRE}b`, 0, 2)).toBe(3);
    expect(advance(`a${FIRE}b`, 1, 1)).toBe(3);
    expect(advance('abc', 1, 0)).toBe(1);
  });

  it('stops at the end of the string', () => {
    expect(advance('abc', 0, 10)).toBe(3);
    expect(advance('abc', 3, 1)).toBe(3);
    expect(advance(`a${FIRE}`, 0, 2147483647)).toBe(3);
  });

  it('never splits a pair, wherever it counts to', () => {
    fc.assert(
      fc.property(anyString, fc.nat(40), (text, count) => {
        const offset = advance(text, 0, count);
        expect(isBoundary(text, offset)).toBe(true);
        expect(characterCount(text, offset)).toBe(Math.min(count, characterCount(text)));
      }),
      { numRuns: 200 },
    );
  });
});

describe('isBoundary', () => {
  it('is false only inside a surrogate pair', () => {
    const text = `a${FIRE}b`;
    expect([0, 1, 2, 3, 4].map((offset) => isBoundary(text, offset))).toEqual([
      true,
      true,
      false,
      true,
      true,
    ]);
  });

  it('is true around lone surrogates', () => {
    expect(isBoundary(`${HIGH}x`, 1)).toBe(true);
    expect(isBoundary(`x${LOW}`, 1)).toBe(true);
  });
});

describe('characters', () => {
  it('keeps pairs together and lone surrogates apart', () => {
    expect(characters(`a${FIRE}b`)).toEqual(['a', FIRE, 'b']);
    expect(characters(`${HIGH}${HIGH}${LOW}`)).toEqual([HIGH, `${HIGH}${LOW}`]);
    expect(characters('')).toEqual([]);
  });

  it('joins back to the string', () => {
    fc.assert(
      fc.property(anyString, (text) => {
        expect(characters(text).join('')).toBe(text);
      }),
      { numRuns: 200 },
    );
  });
});

describe('findFrom', () => {
  it.each([
    ['abcabc', 'c', 0, 2],
    ['abcabc', 'c', 3, 5],
    ['abc', 'x', 0, -1],
    ['abc', '', 0, 0],
    ['abc', '', 3, 3],
    ['', '', 0, 0],
  ])('searches %j for %j from %i', (text, search, from, expected) => {
    expect(findFrom(text, search, from)).toBe(expected);
  });

  it('does not match half of a surrogate pair', () => {
    expect(findFrom(FIRE, HIGH, 0)).toBe(-1);
    expect(findFrom(FIRE, LOW, 0)).toBe(-1);
    expect(findFrom(`${FIRE}${HIGH}`, HIGH, 0)).toBe(2); // a lone one is found
    expect(findFrom(`${HIGH}${FIRE}`, FIRE, 0)).toBe(1);
  });

  it('agrees with indexOf for strings without surrogates', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), fc.string({ maxLength: 3 }), (text, search) => {
        // Printable ASCII only: fc.string() draws from it by default.
        expect(findFrom(text, search, 0)).toBe(text.indexOf(search));
      }),
      { numRuns: 200 },
    );
  });
});

describe('startsWithCharacters and endsWithCharacters', () => {
  it('agree with startsWith and endsWith on whole characters', () => {
    expect(startsWithCharacters('abc', 'ab')).toBe(true);
    expect(startsWithCharacters('abc', '')).toBe(true);
    expect(endsWithCharacters('abc', 'bc')).toBe(true);
    expect(endsWithCharacters('abc', '')).toBe(true);
    expect(endsWithCharacters(`a${FIRE}`, FIRE)).toBe(true);
  });

  it('do not accept half of a surrogate pair', () => {
    expect(startsWithCharacters(FIRE, HIGH)).toBe(false);
    expect(endsWithCharacters(FIRE, LOW)).toBe(false);
    expect(startsWithCharacters(`${HIGH}x`, HIGH)).toBe(true);
    expect(endsWithCharacters(`x${LOW}`, LOW)).toBe(true);
  });
});

describe('replaceAllCharacters', () => {
  it.each([
    ['123456', '234', 'X', '1X56'],
    ['123456', '234', '', '156'],
    ['abc', '', 'x', 'xaxbxcx'],
    ['', '', 'x', 'x'],
    ['abc', '', '', 'abc'],
    [`a${FIRE}c`, '', 'x', `xax${FIRE}xcx`],
    ['aaaa', 'aa', 'b', 'bb'],
    ['aaa', 'aa', 'b', 'ba'],
    ['abc', 'abc', 'x', 'x'],
    ['abc', 'abcd', 'x', 'abc'],
    ['a.c', '.', '-', 'a-c'], // a pattern is text, not a regular expression
    ['abc', 'b', '$&', 'a$&c'], // and so is a substitution
  ])('replaces in %j the pattern %j with %j', (text, pattern, substitution, expected) => {
    expect(replaceAllCharacters(text, pattern, substitution)).toBe(expected);
  });

  it('leaves a surrogate pair alone when the pattern is half of it', () => {
    expect(replaceAllCharacters(FIRE, HIGH, 'x')).toBe(FIRE);
    expect(replaceAllCharacters(`${FIRE}${HIGH}`, HIGH, 'x')).toBe(`${FIRE}x`);
  });

  it('agrees with replaceAll for a non-empty pattern in strings without surrogates', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 3 }),
        fc.string({ maxLength: 3 }),
        (text, pattern, substitution) => {
          // A function replacer, so that `$` in the substitution means nothing to replaceAll.
          expect(replaceAllCharacters(text, pattern, substitution)).toBe(
            text.replaceAll(pattern, () => substitution),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
