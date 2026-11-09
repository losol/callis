// biome-ignore-all lint/suspicious/noTemplateCurlyInString: `${name}` is the substitution syntax under test, not a template.
import { describe, expect, it } from 'vitest';
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { bindHooks, type RegexMatcher } from '../runtime/hooks.ts';
import { BASE_FLAGS, compileRegex, expandSubstitution } from './regex.ts';

// https://hl7.org/fhirpath/N1/#matchesregex-string-boolean: case-sensitive, 'single line' mode,
// Unicode characters. The dialect is JavaScript's with the u flag (docs/spec-notes.md).
describe('compileRegex', () => {
  it('is case-sensitive, with . matching a line terminator and ^ and $ at the ends only', () => {
    const regex = compileRegex('^A.*B$', BASE_FLAGS, undefined);
    expect(regex.test('A\nB')).toBe(true);
    expect(regex.test('a\nb')).toBe(false);
    expect(compileRegex('^b', BASE_FLAGS, undefined).test('a\nb')).toBe(false);
    expect(compileRegex('a$', BASE_FLAGS, undefined).test('a\nb')).toBe(false);
  });

  it('reads the text as characters', () => {
    expect(compileRegex('^.$', BASE_FLAGS, undefined).test('\u{1F525}')).toBe(true);
    expect(compileRegex('^\\p{L}+$', BASE_FLAGS, undefined).test('Åsa')).toBe(true);
  });

  it.each([
    ['(', 'an unterminated group'],
    ['[a-', 'an unterminated class'],
    ['a**', 'a quantifier with nothing to repeat'],
    ['a\\-b', 'an identity escape that the u flag does not allow'],
    ['\\_', 'an identity escape that the u flag does not allow'],
    ['(?i)a', 'an inline flag, which JavaScript does not have'],
    ['a++', 'a possessive quantifier, which JavaScript does not have'],
  ])('raises eval/invalid-argument for %j (%s)', (pattern) => {
    expect(() => compileRegex(pattern, BASE_FLAGS, undefined)).toThrow(
      expect.objectContaining({ code: 'eval/invalid-argument' }),
    );
  });

  // Errors never include input data, and a pattern can be computed from it.
  it.each([
    'secret-name(',
    'secret/name(', // V8 writes the source of this one differently
    'secret\nname(',
  ])('does not put the pattern %j in the error', (pattern) => {
    const error = catchError(() => compileRegex(pattern, BASE_FLAGS, undefined));
    expect(error).toMatchObject({ code: 'eval/invalid-argument' });
    expect((error as Error).cause).toBeUndefined();
    expect((error as Error).message).not.toContain('secret');
    expect((error as Error).message).not.toContain('name');
  });

  it('says why the pattern is not valid', () => {
    expect(catchError(() => compileRegex('(', BASE_FLAGS, undefined))).toMatchObject({
      message: expect.stringMatching(/^The regular expression is not valid: \S+/),
    });
  });

  it('finds every match for matchAll(), from the start and without overlap', () => {
    const matches = [...compileRegex('a.', BASE_FLAGS, undefined).matchAll('ab ac\nad')];
    expect(matches.map((match) => [match[0], match.index])).toEqual([
      ['ab', 0],
      ['ac', 3],
      ['ad', 6],
    ]);
  });
});

// docs/tasks/T0021-hooks-async.md#host-hooks: a host's engine instead of RegExp.
describe('compileRegex with a regex hook', () => {
  const binding = { isAsync: false, signal: undefined };
  /** An engine that records what it was asked to compile and matches with RegExp. */
  function engine(seen: [string, string][]): RegexMatcher | undefined {
    return bindHooks(
      {
        regex(pattern, flags) {
          seen.push([pattern, flags]);
          const regex = new RegExp(pattern, flags);
          return {
            test: (text) => regex.test(text),
            matchAll: (text) => text.matchAll(new RegExp(pattern, `g${flags}`)),
          };
        },
      },
      binding,
    ).regex?.('a.', BASE_FLAGS);
  }

  it('compiles with the hook, which gets the pattern and the base flags without g', () => {
    const seen: [string, string][] = [];
    const matcher = engine(seen);
    expect(seen).toEqual([['a.', 'su']]);
    expect(matcher?.test('xab')).toBe(true);
    expect([...(matcher?.matchAll('ab ac') ?? [])].map((match) => match[0])).toEqual(['ab', 'ac']);
  });

  it('reports a SyntaxError of the hook as an invalid pattern, and passes other errors on', () => {
    const syntax = bindHooks(
      {
        regex: () => {
          throw new SyntaxError('bad pattern');
        },
      },
      binding,
    ).regex;
    expect(() => compileRegex('(', BASE_FLAGS, syntax)).toThrow(
      expect.objectContaining({ code: 'eval/invalid-argument' }),
    );
    const failing = bindHooks(
      {
        regex: () => {
          throw new RangeError('engine limit');
        },
      },
      binding,
    ).regex;
    expect(() => compileRegex('a', BASE_FLAGS, failing)).toThrow(RangeError);
  });

  it('rejects a result that is not a matcher', () => {
    const regex = bindHooks({ regex: () => ({ test: () => true }) as never }, binding).regex;
    expect(() => compileRegex('a', BASE_FLAGS, regex)).toThrow(FhirPathEvaluationError);
    expect(catchError(() => compileRegex('a', BASE_FLAGS, regex))).toMatchObject({
      code: 'eval/invalid-argument',
    });
  });
});

function catchError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** Expands `substitution` for the first match of `pattern` in `input`. */
function expand(pattern: string, input: string, substitution: string): string {
  const [match] = compileRegex(pattern, BASE_FLAGS, undefined).matchAll(input);
  if (match === undefined) {
    throw new Error('the test needs a match');
  }
  return expandSubstitution(substitution, match, input);
}

describe('expandSubstitution', () => {
  const date = '(\\d+)-(\\d+)-(\\d+)';

  it.each([
    // The forms of JavaScript's replacement patterns.
    ['$3/$2/$1', '06/05/2024'],
    ['$&', '2024-05-06'],
    ["[$`|$']", '[x | y]'], // the text before the match, then the text after it
    ['$$', '$'],
    ['$$1', '$1'],
    ['cost $5', 'cost $5'], // no group 5: plain text, as in JavaScript
    ['$0', '$0'],
    ['$00', '$00'],
    ['$10', '20240'], // no group 10: group 1, then 0
    ['$01', '2024'],
    ['$', '$'],
    ['a$', 'a$'],
    ['$x', '$x'],
    ['$<y>', '$<y>'], // no named groups: plain text
    // The form of the spec's example.
    ['${3}/${2}/${1}', '06/05/2024'],
    ['${0}', '2024-05-06'],
    ['${1}0', '20240'],
    ['$${1}', '${1}'],
    ['${1', '${1'],
    ['no references', 'no references'],
    ['', ''],
  ])('expands %j to %j', (substitution, expected) => {
    expect(expand(date, 'x 2024-05-06 y', substitution)).toBe(expected);
  });

  it.each([
    ['${day}-${month}-${year}', '30-11-1972'],
    ['$<day>-$<month>-$<year>', '30-11-1972'],
    ['$<nope>|', '|'], // as in JavaScript, a group that does not exist is empty here
    ['$<day', '$<day'],
    ['${day}${day}', '3030'],
  ])('expands %j for named groups to %j', (substitution, expected) => {
    // https://hl7.org/fhirpath/STU3/en/#string-manipulation, the replaceMatches() example
    const pattern = '\\b(?<month>\\d{1,2})/(?<day>\\d{1,2})/(?<year>\\d{2,4})\\b';
    expect(expand(pattern, '11/30/1972', substitution)).toBe(expected);
  });

  it('uses the empty string for a group that took no part in the match', () => {
    expect(expand('(a)|(b)', 'b', '[$1|$2]')).toBe('[|b]');
    expect(expand('(a)|(b)', 'b', '[${1}|${2}]')).toBe('[|b]');
    expect(expand('(?<a>a)|(?<b>b)', 'b', '[${a}|${b}|$<a>]')).toBe('[|b|]');
  });

  it.each([
    ['(a)', '${2}'],
    ['(a)', '${99999999999999999999}'],
    ['(a)', '${name}'],
    ['(?<x>a)', '${y}'],
    ['(a)', '${}'],
    ['a', '${toString}'], // never a member of Object.prototype
    ['(?<x>a)', '${constructor}'],
  ])('raises eval/invalid-argument when %j has no group for %j', (pattern, substitution) => {
    expect(() => expand(pattern, 'a', substitution)).toThrow(
      expect.objectContaining({ code: 'eval/invalid-argument' }),
    );
  });

  it('does not put the name of the missing group in the error', () => {
    expect(catchError(() => expand('(a)', 'a', '${secret}'))).toMatchObject({
      message: expect.not.stringContaining('secret'),
    });
  });
});
