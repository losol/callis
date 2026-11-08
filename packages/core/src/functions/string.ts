/**
 * The string manipulation functions
 * ([N1 §5.6](https://hl7.org/fhirpath/N1/#string-manipulation),
 * [3.0.0](https://hl7.org/fhirpath/STU3/en/#string-manipulation)).
 *
 * They work on a single String. An empty input or argument gives an empty result, more than one
 * item raises `eval/singleton-expected`, and an item that is not a String raises
 * `eval/type-mismatch` ([singleton evaluation](https://hl7.org/fhirpath/N1/#singleton-evaluation-of-collections)).
 * Arguments are checked whether or not the input is empty, so an error does not depend on the data.
 * A character is a Unicode scalar value (`characters.ts`), and a regular expression is a JavaScript
 * one with the `u` flag (`regex.ts`); `docs/spec-notes.md` has the details.
 */
import { type Collection, EMPTY, fromBoolean, type Item } from '../runtime/collection.ts';
import { asInteger } from '../runtime/item-conversion.ts';
import { toSystemValue } from '../runtime/node-value.ts';
import { singleton } from '../runtime/singleton.ts';
import {
  advance,
  characterCount,
  characters,
  endsWithCharacters,
  findFrom,
  replaceAllCharacters,
  startsWithCharacters,
} from './characters.ts';
import {
  defineValueFunction,
  type FunctionDefinition,
  type ParamSpec,
  type TypeHint,
} from './define.ts';
import { BASE_FLAGS, compileRegex, expandSubstitution } from './regex.ts';

/** The item as a String, or undefined when it is not one. A FHIR string-like primitive is. */
function asString(item: Item): string | undefined {
  const value = toSystemValue(item);
  return typeof value === 'string' ? value : undefined;
}

function stringOf(collection: Collection): string | undefined {
  return singleton(collection, 'String', asString);
}

function integerOf(collection: Collection): number | undefined {
  return singleton(collection, 'Integer', asInteger);
}

/**
 * Defines a function of a String input and String arguments. It computes nothing and returns
 * empty when the input or any argument is empty.
 */
function defineStringFunction(
  name: string,
  paramNames: readonly string[],
  returns: TypeHint,
  compute: (text: string, ...args: readonly string[]) => Collection,
): FunctionDefinition {
  const params: readonly ParamSpec[] = paramNames.map((paramName) => ({
    kind: 'value',
    name: paramName,
  }));
  return defineValueFunction(
    name,
    params,
    (input, args) => {
      const text = stringOf(input);
      const strings: string[] = [];
      let empty = text === undefined;
      for (const arg of args) {
        const value = stringOf(arg);
        if (value === undefined) {
          empty = true;
        } else {
          strings.push(value);
        }
      }
      return empty || text === undefined ? EMPTY : compute(text, ...strings);
    },
    { returns },
  );
}

const BOOLEAN: TypeHint = { type: 'Boolean', singleton: true };
const STRING: TypeHint = { type: 'String', singleton: true };

/**
 * `indexOf(substring)`: the 0-based index in characters of the first occurrence, -1 when there is
 * none, and 0 for the empty string.
 * @see https://hl7.org/fhirpath/N1/#indexofsubstring-string-integer
 */
export const indexOfFunction: FunctionDefinition = defineStringFunction(
  'indexOf',
  ['substring'],
  { type: 'Integer', singleton: true },
  (text, substring) => {
    const offset = findFrom(text, substring, 0);
    return [offset === -1 ? -1 : characterCount(text, offset)];
  },
);

/**
 * `substring(start [, length])`: at most `length` characters from the 0-based character `start`.
 * Empty when `start` is outside the string, which includes its end; `''` for a `length` of zero or
 * less; the rest of the string for an empty `length`.
 * @see https://hl7.org/fhirpath/N1/#substringstart-integer-length-integer-string
 */
export const substringFunction: FunctionDefinition = defineValueFunction(
  'substring',
  [
    { kind: 'value', name: 'start' },
    { kind: 'value', name: 'length', optional: true },
  ],
  (input, args) => {
    const text = stringOf(input);
    const start = integerOf(args[0] ?? EMPTY);
    const length = integerOf(args[1] ?? EMPTY);
    if (text === undefined || start === undefined || start < 0) {
      return EMPTY;
    }
    const from = advance(text, 0, start);
    if (from >= text.length) {
      return EMPTY;
    }
    if (length === undefined) {
      return [text.slice(from)];
    }
    return [length <= 0 ? '' : text.slice(from, advance(text, from, length))];
  },
  { returns: STRING },
);

/**
 * `startsWith(prefix)`: whether the input starts with the prefix; true for the empty prefix.
 * @see https://hl7.org/fhirpath/N1/#startswithprefix-string-boolean
 */
export const startsWithFunction: FunctionDefinition = defineStringFunction(
  'startsWith',
  ['prefix'],
  BOOLEAN,
  (text, prefix) => fromBoolean(startsWithCharacters(text, prefix)),
);

/**
 * `endsWith(suffix)`: whether the input ends with the suffix; true for the empty suffix.
 * @see https://hl7.org/fhirpath/N1/#endswithsuffix-string-boolean
 */
export const endsWithFunction: FunctionDefinition = defineStringFunction(
  'endsWith',
  ['suffix'],
  BOOLEAN,
  (text, suffix) => fromBoolean(endsWithCharacters(text, suffix)),
);

/**
 * `contains(substring)`: whether the input contains the substring; true for the empty substring.
 * Not the `contains` operator, which looks for an item in a collection.
 * @see https://hl7.org/fhirpath/N1/#containssubstring-string-boolean
 */
export const containsFunction: FunctionDefinition = defineStringFunction(
  'contains',
  ['substring'],
  BOOLEAN,
  (text, substring) => fromBoolean(findFrom(text, substring, 0) !== -1),
);

/**
 * `upper()`: the input in upper case. The conversion is the Unicode default one, with no locale,
 * so `'ß'` becomes `'SS'`.
 * @see https://hl7.org/fhirpath/N1/#upper-string
 */
export const upperFunction: FunctionDefinition = defineStringFunction(
  'upper',
  [],
  STRING,
  (text) => [text.toUpperCase()],
);

/**
 * `lower()`: the input in lower case, by the Unicode default conversion with no locale.
 * @see https://hl7.org/fhirpath/N1/#lower-string
 */
export const lowerFunction: FunctionDefinition = defineStringFunction(
  'lower',
  [],
  STRING,
  (text) => [text.toLowerCase()],
);

/**
 * `replace(pattern, substitution)`: every occurrence of the plain-text pattern replaced. An empty
 * pattern surrounds every character with the substitution: `'abc'.replace('', 'x')` is `'xaxbxcx'`.
 * @see https://hl7.org/fhirpath/N1/#replacepattern-string-substitution-string-string
 */
export const replaceFunction: FunctionDefinition = defineStringFunction(
  'replace',
  ['pattern', 'substitution'],
  STRING,
  (text, pattern, substitution) => [replaceAllCharacters(text, pattern, substitution)],
);

/**
 * `matches(regex)`: whether the regular expression matches anywhere in the input. Anchor it with
 * `^` and `$` to match the whole input.
 * @see https://hl7.org/fhirpath/N1/#matchesregex-string-boolean
 */
export const matchesFunction: FunctionDefinition = defineStringFunction(
  'matches',
  ['regex'],
  BOOLEAN,
  (text, regex) => fromBoolean(compileRegex(regex, BASE_FLAGS).test(text)),
);

/**
 * `replaceMatches(regex, substitution)`: every match of the regular expression replaced by the
 * substitution, which can refer to groups of the match (`expandSubstitution()` in `regex.ts`). An
 * empty regex changes nothing, unlike an empty pattern of `replace()`.
 * @see https://hl7.org/fhirpath/N1/#replacematchesregex-string-substitution-string-string
 */
export const replaceMatchesFunction: FunctionDefinition = defineStringFunction(
  'replaceMatches',
  ['regex', 'substitution'],
  STRING,
  (text, regex, substitution) => {
    if (regex === '') {
      return [text];
    }
    let result = '';
    let last = 0;
    for (const match of text.matchAll(compileRegex(regex, `g${BASE_FLAGS}`))) {
      const index = match.index ?? 0;
      result += text.slice(last, index) + expandSubstitution(substitution, match, text);
      last = index + match[0].length;
    }
    return [result + text.slice(last)];
  },
);

/**
 * `length()`: the number of characters, which are Unicode scalar values: `'🔥'` has one and
 * `'é'` written as `e` and a combining accent has two.
 * @see https://hl7.org/fhirpath/N1/#length-integer
 */
export const lengthFunction: FunctionDefinition = defineStringFunction(
  'length',
  [],
  { type: 'Integer', singleton: true },
  (text) => [characterCount(text)],
);

/**
 * `toChars()`: the characters of the input as single-character strings, never splitting a
 * surrogate pair.
 * @see https://hl7.org/fhirpath/N1/#tochars-collection
 */
export const toCharsFunction: FunctionDefinition = defineStringFunction(
  'toChars',
  [],
  { type: 'String' },
  (text) => characters(text),
);

/** The string manipulation functions of the standard library. */
export const STRING_FUNCTIONS: readonly FunctionDefinition[] = Object.freeze([
  indexOfFunction,
  substringFunction,
  startsWithFunction,
  endsWithFunction,
  containsFunction,
  upperFunction,
  lowerFunction,
  replaceFunction,
  matchesFunction,
  replaceMatchesFunction,
  lengthFunction,
  toCharsFunction,
]);
