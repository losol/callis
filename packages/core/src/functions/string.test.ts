// biome-ignore-all lint/suspicious/noTemplateCurlyInString: `${name}` is the substitution syntax under test, not a template.
import { describe, expect, it } from 'vitest';
import { testRegistry } from '../../test/support/test-functions.ts';
import { evaluateAsync } from '../api/compile.ts';
import { compile, evaluate } from '../index.ts';
import { createRegistry } from './registry.ts';

// N1 §5.6 and FHIRPath 3.0.0 "String Manipulation". Each row cites its spec example or the HL7
// test of the same shape.
// https://hl7.org/fhirpath/N1/#string-manipulation
// https://hl7.org/fhirpath/STU3/en/#string-manipulation
const patient = Object.freeze({
  resourceType: 'Patient',
  name: Object.freeze([
    Object.freeze({ family: 'Salmon', given: ['Peter', 'Jo'] }),
    Object.freeze({ family: 'Chalmers', given: ['Mina'] }),
  ]),
});

/** The result of the expression on the model-less patient. */
function run(
  expression: string,
  input: unknown = patient,
  variables?: Record<string, unknown>,
): unknown[] {
  return evaluate(input, expression, variables === undefined ? {} : { variables });
}

/** Values whose types analysis cannot see, so that the functions check them at runtime. */
const VARIABLES = { one: 1, flag: true, text: '1', half: 1.5 };

const FIRE = '\u{1F525}'; // 🔥, one character that JavaScript stores as two code units

describe('the standard library', () => {
  it.each([
    'indexOf',
    'substring',
    'startsWith',
    'endsWith',
    'contains',
    'upper',
    'lower',
    'replace',
    'matches',
    'replaceMatches',
    'length',
    'toChars',
  ])('has %s()', (name) => {
    expect(createRegistry().get(name)?.name).toBe(name);
  });
});

describe('indexOf()', () => {
  it.each([
    ["'abcdefg'.indexOf('bc')", [1]], // N1 §5.6.1
    ["'abcdefg'.indexOf('x')", [-1]],
    ["'abcdefg'.indexOf('abcdefg')", [0]],
    ["'LogicalModel-Person'.indexOf('-')", [12]], // testIndexOf1
    ["'LogicalModel-Person'.indexOf('z')", [-1]], // testIndexOf2
    ["'LogicalModel-Person'.indexOf('')", [0]], // testIndexOf3
    ["''.indexOf('')", [0]],
    ["'abcabc'.indexOf('c')", [2]], // the first occurrence
    ["'LogicalModel-Person'.indexOf({})", []], // testIndexOf5
    ["{}.indexOf('-')", []], // testIndexOf4
    ['{}.indexOf({})', []], // testIndexOf6
    ["'a🔥b'.indexOf('🔥')", [1]], // 3.0.0: characters, not code units
    ["'a🔥b'.indexOf('b')", [2]], // 3.0.0: not 3
    ["'a\\uD83D\\uDD25b'.indexOf('b')", [2]], // 3.0.0: an escaped pair is one character
    ["'e\\u0301x'.indexOf('x')", [2]], // a combining accent is a character
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });
});

describe('substring()', () => {
  it.each([
    ["'abcdefg'.substring(3)", ['defg']], // N1 §5.6.2
    ["'abcdefg'.substring(1, 2)", ['bc']],
    ["'abcdefg'.substring(6, 2)", ['g']],
    ["'abcdefg'.substring(7, 1)", []],
    ["'abcdefg'.substring(-1, 1)", []], // 3.0.0
    ["'abcdefg'.substring(3, 0)", ['']],
    ["'abcdefg'.substring(3, -1)", ['']],
    ["'abcdefg'.substring(-1, -1)", []], // start is checked first
    ["''.substring(0)", []],
    ["'12345'.substring(2)", ['345']], // testSubstring1
    ["'12345'.substring(2,1)", ['3']], // testSubstring2
    ["'12345'.substring(2,5)", ['345']], // testSubstring3: fewer characters than asked for
    ["'12345'.substring(25)", []], // testSubstring4
    ["'12345'.substring(-1)", []], // testSubstring5
    ["'12345'.substring(5)", []], // 3.0.0: a start at the end is outside the string
    ["'12345'.substring(4)", ['5']],
    ["'abcdefg'.substring(0, -1)", ['']], // testSubstring14
    ["'abcdefg'.substring(1, 2147483647)", ['bcdefg']], // testSubstring15
    ["'abcdefg'.substring(3, {})", ['defg']], // testSubstring17: an empty length is no length
    ["'abcdefg'.substring(0, {})", ['abcdefg']], // testSubstring18
    ["'string'.substring({})", []], // testSubstring12
    ['{}.substring({})', []], // testSubstring11
    ['{}.substring(25)', []], // testSubstring9
    ["'LogicalModel-Person'.substring(0, 'LogicalModel-Person'.indexOf('-'))", ['LogicalModel']], // testSubstring8
    [`'a${FIRE}b${FIRE}c'.substring(1, 1)`, [FIRE]], // characters, not code units
    [`'a${FIRE}b${FIRE}c'.substring(2)`, [`b${FIRE}c`]],
    [`'a${FIRE}b${FIRE}c'.substring(4)`, ['c']],
    [`'a${FIRE}b${FIRE}c'.substring(5)`, []],
    ["'e\\u0301'.substring(1)", ['́']],
    ["name.given.where(substring(0, 1) = 'P')", ['Peter']], // N1 §5.6 example, with where()
    ["name.where(family.substring(1, 3) = 'alm').given", ['Peter', 'Jo']],
    ["'abcdefg'.where(substring(0, length() - 5) = 'ab')", ['abcdefg']], // testSubstring10
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });
});

describe('startsWith(), endsWith() and contains()', () => {
  it.each([
    ["'abcdefg'.startsWith('abc')", [true]], // N1 §5.6.3
    ["'abcdefg'.startsWith('xyz')", [false]],
    ["'12345'.startsWith('2')", [false]], // testStartsWith1
    ["'12345'.startsWith('12345')", [true]], // testStartsWith5
    ["'12345'.startsWith('123456')", [false]], // testStartsWith6
    ["'12345'.startsWith('')", [true]], // testStartsWith7
    ["''.startsWith('')", [true]], // testStartsWith10
    ["{}.startsWith('1')", []], // testStartsWith8
    ["{}.startsWith('')", []], // testStartsWith9
    ["'12345'.startsWith({})", []],
    ["'abcdefg'.endsWith('efg')", [true]], // N1 §5.6.4
    ["'abcdefg'.endsWith('abc')", [false]],
    ["'12345'.endsWith('2')", [false]], // testEndsWith1
    ["'12345'.endsWith('45')", [true]], // testEndsWith3
    ["'12345'.endsWith('012345')", [false]], // testEndsWith6
    ["'12345'.endsWith('')", [true]], // testEndsWith7
    ["{}.endsWith('1')", []], // testEndsWith8
    ["'12345'.endsWith({})", []],
    [`'a${FIRE}'.endsWith('${FIRE}')`, [true]],
    ["'abc'.contains('b')", [true]], // N1 §5.6.5
    ["'abc'.contains('bc')", [true]],
    ["'abc'.contains('d')", [false]],
    ["'12345'.contains('35')", [false]], // testContainsString4
    ["'12345'.contains('12345')", [true]], // testContainsString5
    ["'12345'.contains('012345')", [false]], // testContainsString6
    ["'12345'.contains('')", [true]], // testContainsString7
    ["{}.contains('a')", []], // testContainsString8
    ["{}.contains('')", []], // testContainsString9
    ["'12345'.contains({})", []],
    ["name.where(family.startsWith('S')).given", ['Peter', 'Jo']],
    ["name.given.where(endsWith('o'))", ['Jo']],
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });

  it('is told apart from the contains operator, which looks for an item', () => {
    expect(run("'abc'.contains('b')")).toEqual([true]);
    expect(run("'abc' contains 'b'")).toEqual([false]);
    expect(run("name.given contains 'Jo'")).toEqual([true]);
  });
});

describe('upper() and lower()', () => {
  it.each([
    ["'abcdefg'.upper()", ['ABCDEFG']], // N1 §5.6.6
    ["'AbCdefg'.upper()", ['ABCDEFG']],
    ["'ABCDEFG'.lower()", ['abcdefg']], // N1 §5.6.7
    ["'aBcDEFG'.lower()", ['abcdefg']],
    ["'t'.upper() = 'T'", [true]], // testCase1
    ["'T'.lower() = 't'", [true]], // testCase4
    ["''.upper()", ['']],
    ["'Åsa ß'.upper()", ['ÅSA SS']], // the Unicode default mapping, with no locale
    ["'ÅSA'.lower()", ['åsa']],
    ['{}.upper()', []],
    ['{}.lower()', []],
    ['name.family.first().upper()', ['SALMON']],
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });
});

describe('replace()', () => {
  it.each([
    ["'abcdefg'.replace('cde', '123')", ['ab123fg']], // N1 §5.6.8
    ["'abcdefg'.replace('cde', '')", ['abfg']],
    ["'abc'.replace('', 'x')", ['xaxbxcx']],
    ["'123456'.replace('234', 'X')", ['1X56']], // testReplace1
    ["'123456'.replace('234', '')", ['156']], // testReplace3
    ["''.replace('', 'x')", ['x']],
    ["'a🔥c'.replace('', 'x')", ['xax🔥xcx']], // 3.0.0: the character stays whole
    ["'a\\uD83D\\uDD25c'.replace('', 'x')", ['xax🔥xcx']],
    ["'a.c'.replace('.', '-')", ['a-c']], // the pattern is text
    ["'abc'.replace('.', 'x')", ['abc']],
    ["'abc'.replace('b', '$&')", ['a$&c']], // and so is the substitution
    ["'aaaa'.replace('aa', 'b')", ['bb']],
    ["{}.replace('234', 'X')", []], // testReplace4
    ["'123'.replace({}, 'X')", []], // testReplace5
    ["'123'.replace('2', {})", []], // testReplace6
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });
});

describe('matches()', () => {
  const url = "'http://fhir.org/guides/cqf/common/Library/FHIR-ModelInfo|4.0.1'";

  it.each([
    ["'FHIR'.matches('FHIR')", [true]], // testMatchesCaseSensitive1
    ["'FHIR'.matches('fhir')", [false]], // testMatchesCaseSensitive2
    ["'FHIR'.matches({})", []], // testMatchesEmpty
    ["{}.matches('FHIR')", []], // testMatchesEmpty2
    ['{}.matches({})', []], // testMatchesEmpty3
    ["'A\\nB'.matches('A.*B')", [true]], // testMatchesSingleLineMode1
    [`${url}.matches('library')`, [false]], // testMatchesWithinUrl1
    [`${url}.matches('Library')`, [true]], // testMatchesWithinUrl2
    [`${url}.matches('^Library$')`, [false]], // testMatchesWithinUrl3
    [`${url}.matches('.*Library.*')`, [true]], // testMatchesWithinUrl1a
    [`${url}.matches('Measure')`, [false]], // testMatchesWithinUrl4
    ["'N8000123123'.matches('^N[0-9]{8}$')", [false]], // 3.0.0 example
    ["'N8000123123'.matches('N[0-9]{8}')", [true]], // 3.0.0 example
    ["'first line\\nsecond line'.matches('^second')", [false]], // ^ is the start of the string
    ["'abc'.matches('')", [true]],
    ["''.matches('^$')", [true]],
    [`'${FIRE}${FIRE}${FIRE}'.matches('^.{3}$')`, [true]], // the u flag: a character each
    [`'${FIRE}'.matches('^\\\\p{Emoji_Presentation}$')`, [true]],
    ["'Åsa'.matches('^\\\\p{Lu}\\\\p{Ll}+$')", [true]],
    ["'ab12'.matches('^(?<letters>[a-z]+)(?<digits>[0-9]+)$')", [true]],
    ["'ab'.matches('(?<=a)b')", [true]], // lookbehind
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });

  it('keeps no state between evaluations of a compiled expression', () => {
    const expression = compile("'aaa'.matches('a')");
    expect([expression.evaluate({}), expression.evaluate({}), expression.evaluate({})]).toEqual([
      [true],
      [true],
      [true],
    ]);
  });
});

describe('replaceMatches()', () => {
  it.each([
    ["'123456'.replaceMatches('234', 'X')", ['1X56']], // testReplaceMatches1
    ["'abc'.replaceMatches('', 'x')", ['abc']], // testReplaceMatches2: unlike replace()
    ["'123456'.replaceMatches('234', '')", ['156']], // testReplaceMatches3
    ["{}.replaceMatches('234', 'X')", []], // testReplaceMatches4
    ["'123'.replaceMatches({}, 'X')", []], // testReplaceMatches5
    ["'123'.replaceMatches('2', {})", []], // testReplaceMatches6
    ["'abc123'.replaceMatches('[0-9]', '-')", ['abc---']], // testReplaceMatches7
    ["'aaabaa'.replaceMatches('aa', '\"aa\"')", ['"aa"ab"aa"']], // 3.0.0 example
    [
      // N1 §5.6.10 and 3.0.0: named groups, referred to as ${name}
      `'11/30/1972'.replaceMatches('\\\\b(?<month>\\\\d{1,2})/(?<day>\\\\d{1,2})/(?<year>\\\\d{2,4})\\\\b', '\${day}-\${month}-\${year}')`,
      ['30-11-1972'],
    ],
    ["'abc'.replaceMatches('x*', '-')", ['-a-b-c-']], // a match can be empty
    [`'${FIRE}'.replaceMatches('x*', '-')`, [`-${FIRE}-`]], // and then never splits a character
    ["'a1b22'.replaceMatches('[0-9]+', '#')", ['a#b#']],
    ["'A\\nB'.replaceMatches('A.B', 'x')", ['x']], // single line mode
    ["'aBc'.replaceMatches('b', 'x')", ['aBc']], // case-sensitive
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });

  it.each([
    ['2024-05-06', '(\\d+)-(\\d+)-(\\d+)', '$3/$2/$1', '06/05/2024'],
    ['2024-05-06', '(\\d+)-(\\d+)-(\\d+)', '${3}/${2}/${1}', '06/05/2024'],
    ['2024-05-06', '(?<y>\\d+)-(?<m>\\d+)', '$<m>/$<y>', '05/2024-06'],
    ['2024-05-06', '(?<y>\\d+)-(?<m>\\d+)', '${m}/${y}', '05/2024-06'],
    ['a-b', '-', '$&$&', 'a--b'],
    ['price', 'price', '$$5', '$5'],
    ['price', 'price', 'costs $5', 'costs $5'],
  ])(
    'replaces in %j the matches of %j with %j to give %j',
    (input, regex, substitution, expected) => {
      const options = { variables: { regex, substitution } };
      expect(evaluate({ input }, 'input.replaceMatches(%regex, %substitution)', options)).toEqual([
        expected,
      ]);
    },
  );

  it('raises eval/invalid-argument for a reference to a missing group when it replaces a match', () => {
    const options = { variables: { substitution: '${nope}' } };
    expect(() => evaluate({}, "'a'.replaceMatches('a', %substitution)", options)).toThrow(
      expect.objectContaining({ code: 'eval/invalid-argument' }),
    );
    expect(evaluate({}, "'b'.replaceMatches('a', %substitution)", options)).toEqual(['b']);
  });
});

describe('length()', () => {
  it.each([
    ["'123456'.length()", [6]], // testLength1
    ["'1'.length()", [1]], // testLength4
    ["''.length()", [0]], // testLength5
    ['{}.length()', []], // testLength6
    ["'abc'.length()", [3]], // 3.0.0
    ["'\\u0065\\u0301'.length()", [2]], // a combining accent is a character
    ["'\\u00E9'.length()", [1]],
    ["'\\uD83D\\uDD25'.length()", [1]], // a surrogate pair is one character
    [`'${FIRE}${FIRE}'.length()`, [2]],
    ["'123456'.length() = 6", [true]],
    ['name.family.first().length()', [6]],
    ['name.given.where(length() > 2)', ['Peter', 'Mina']],
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });

  it('counts a lone surrogate from input data as one character', () => {
    const input = { text: `a\uD83D${FIRE}\uDD25` };
    expect(run('text.length()', input)).toEqual([4]);
    expect(run('text.toChars().count()', input)).toEqual([4]);
  });
});

describe('toChars()', () => {
  it.each([
    ["'abc'.toChars()", ['a', 'b', 'c']], // N1 §5.6.12
    ["'t2'.toChars() = 't' | '2'", [true]], // testToChars1
    ["''.toChars()", []],
    ['{}.toChars()', []],
    ["'\\u0065\\u0301'.toChars()", ['e', '́']], // 3.0.0
    ["'a\\uD83D\\uDD25b'.toChars()", ['a', FIRE, 'b']], // 3.0.0: no split pairs
    [`'${FIRE}'.toChars().count()`, [1]],
  ])('%s', (expression, expected) => {
    expect(run(expression)).toEqual(expected);
  });

  it('gives a new collection each time', () => {
    const compiled = compile("'ab'.toChars()");
    compiled.evaluate({}).push('x');
    expect(compiled.evaluate({})).toEqual(['a', 'b']);
  });
});

describe('input from data', () => {
  it('is empty for a missing element', () => {
    expect(run('birthDate.upper()')).toEqual([]);
    expect(run("birthDate.startsWith('a')")).toEqual([]);
    expect(run('birthDate.toChars()')).toEqual([]);
    expect(run('birthDate.length()')).toEqual([]);
  });

  it('does not match half of a surrogate pair', () => {
    const options = { variables: { high: '\uD83D', low: '\uDD25', x: 'x' } };
    const input = { text: FIRE };
    expect(evaluate(input, 'text.startsWith(%high)', options)).toEqual([false]);
    expect(evaluate(input, 'text.endsWith(%low)', options)).toEqual([false]);
    expect(evaluate(input, 'text.contains(%high)', options)).toEqual([false]);
    expect(evaluate(input, 'text.indexOf(%low)', options)).toEqual([-1]);
    expect(evaluate(input, 'text.replace(%high, %x)', options)).toEqual([FIRE]);
  });
});

describe('errors', () => {
  const calls = [
    "indexOf('a')",
    'substring(0)',
    "startsWith('a')",
    "endsWith('a')",
    "contains('a')",
    'upper()',
    'lower()',
    "replace('a', 'b')",
    "matches('a')",
    "replaceMatches('a', 'b')",
    'length()',
    'toChars()',
  ];

  it.each(calls)('%s raises eval/singleton-expected for more than one item', (call) => {
    expect(() => run(`('ab' | 'cd').${call}`)).toThrow(
      expect.objectContaining({ code: 'eval/singleton-expected' }),
    );
  });

  it.each(calls)('%s raises eval/type-mismatch for an item that is not a String', (call) => {
    expect(() => run(`%one.${call}`, patient, VARIABLES)).toThrow(
      expect.objectContaining({ code: 'eval/type-mismatch' }),
    );
    expect(() => run(`%flag.${call}`, patient, VARIABLES)).toThrow(
      expect.objectContaining({ code: 'eval/type-mismatch' }),
    );
  });

  // T0024: a literal that is not a String is rejected when the expression is compiled.
  it.each(calls)('%s rejects a literal that is not a String at compile time', (call) => {
    expect(() => run(`(1).${call}`)).toThrow(
      expect.objectContaining({ code: 'semantic/type-mismatch' }),
    );
    expect(() => run(`true.${call}`)).toThrow(
      expect.objectContaining({ code: 'semantic/type-mismatch' }),
    );
  });

  it('raises an error for an object, as testStartsWithNonString1 and testContainsNonString1 expect', () => {
    const appointment = { identifier: { system: 'urn:x', value: '1' } };
    expect(() => run("identifier.startsWith('rand')", appointment)).toThrow(
      expect.objectContaining({ code: 'eval/type-mismatch' }),
    );
    expect(() => run("identifier.contains('rand')", appointment)).toThrow(
      expect.objectContaining({ code: 'eval/type-mismatch' }),
    );
  });

  it.each([
    ["'abc'.indexOf(%one)", 'eval/type-mismatch'],
    ["'abc'.startsWith(%flag)", 'eval/type-mismatch'],
    ["'abc'.replace('a', %one)", 'eval/type-mismatch'],
    ["'abc'.matches(%one)", 'eval/type-mismatch'],
    ["'abc'.substring(%text)", 'eval/type-mismatch'],
    ["'abc'.substring(%half)", 'eval/type-mismatch'], // nothing converts to Integer implicitly
    ["'abc'.substring(1, %text)", 'eval/type-mismatch'],
    ["'abc'.indexOf('a' | 'b')", 'eval/singleton-expected'],
    ["'abc'.substring(0 | 1)", 'eval/singleton-expected'],
    ["'abc'.substring(0, 1 | 2)", 'eval/singleton-expected'],
    ["'abc'.replace('a' | 'b', 'c')", 'eval/singleton-expected'],
    // The data does not decide whether an argument is checked.
    ['{}.indexOf(%one)', 'eval/type-mismatch'],
    ['{}.substring(%text)', 'eval/type-mismatch'],
    ["{}.replace('a', %one)", 'eval/type-mismatch'],
    // testSubstring10a: an argument is evaluated where the call is written, so length() is the
    // length of the root, which is not a string.
    ['name.family.first().substring(2, length() - 5)', 'eval/type-mismatch'],
  ])('%s raises %s', (expression, code) => {
    expect(() => run(expression, patient, VARIABLES)).toThrow(expect.objectContaining({ code }));
  });

  // T0024: the same with literals, and with length(), which is always an Integer, is found when
  // the expression is compiled (testStartsWith12a expects a semantic error).
  it.each([
    "'abc'.indexOf(1)",
    "'abc'.startsWith(true)",
    "'abc'.replace('a', 1)",
    "'abc'.matches(1)",
    "'abc'.substring('1')",
    "'abc'.substring(1.5)",
    "'abc'.substring(1, '1')",
    '{}.indexOf(1)',
    "{}.substring('1')",
    "{}.replace('a', 1)",
    "'987654321'.startsWith(length())",
  ])('%s raises semantic/type-mismatch at compile time', (expression) => {
    expect(() => run(expression)).toThrow(
      expect.objectContaining({ code: 'semantic/type-mismatch' }),
    );
  });

  it.each([
    "'a'.matches('(')",
    "'a'.matches('a\\\\-b')",
    "'a'.replaceMatches('[', 'x')",
    "'a'.replaceMatches('(?i)a', 'x')",
  ])('%s raises eval/invalid-argument for a pattern that is not valid', (expression) => {
    expect(() => run(expression)).toThrow(
      expect.objectContaining({ code: 'eval/invalid-argument' }),
    );
  });

  it('puts the expression and the call in the error', () => {
    const expression = "'a'.matches('(')";
    expect(() => run(expression)).toThrow(
      expect.objectContaining({ expression, span: expect.objectContaining({ start: 0 }) }),
    );
  });

  it.each([
    "'a'.indexOf()",
    "'a'.indexOf('a', 'b')",
    "'a'.upper(1)",
    "'a'.length(1)",
    "'a'.toChars(1)",
    "'a'.substring()",
    "'a'.substring(1, 2, 3)",
    "'a'.replace('a')",
    "'a'.replaceMatches('a')",
    "'a'.matches()",
  ])('%s raises semantic/wrong-arity at compile time', (expression) => {
    expect(() => compile(expression)).toThrow(
      expect.objectContaining({ code: 'semantic/wrong-arity' }),
    );
  });
});

describe('with host functions that return promises', () => {
  const options = { functions: testRegistry() };

  it('works on their results and on their arguments', async () => {
    await expect(
      evaluateAsync(patient, 'name.family.first().testAsync().upper()', options),
    ).resolves.toEqual(['SALMON']);
    await expect(
      evaluateAsync(
        patient,
        "'Sal'.startsWith(name.family.first().testThenable().substring(0, 3))",
        options,
      ),
    ).resolves.toEqual([true]);
  });

  it('raises the same errors', async () => {
    await expect(
      evaluateAsync(patient, 'name.family.testAsync().length()', options),
    ).rejects.toMatchObject({ code: 'eval/singleton-expected' });
  });
});
