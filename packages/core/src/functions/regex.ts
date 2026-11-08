/**
 * Regular expressions for `matches()` and `replaceMatches()`
 * ([N1 §5.6.9–10](https://hl7.org/fhirpath/N1/#matchesregex-string-boolean)). FHIRPath does not
 * prescribe a dialect, so Callis uses JavaScript's `RegExp` and records the differences from PCRE
 * in `docs/spec-notes.md`.
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';

/**
 * The flags every FHIRPath regular expression has: `u` for Unicode mode, so a pattern works on
 * characters and `\p{…}` is available, and `s` for the "single line" mode that N1 asks for, in
 * which `.` also matches a line terminator. `^` and `$` match only at the ends of the string.
 */
export const BASE_FLAGS = 'su';

/**
 * Compiles a regular expression with the given flags, which include {@link BASE_FLAGS}.
 *
 * The error says why the pattern is not valid but does not repeat it: a pattern can be computed
 * from input data, and errors never include input data
 * ([architecture: security and robustness](https://github.com/losol/callis/blob/main/docs/architecture.md#security-and-robustness)).
 * For the same reason the engine's error is not kept as the `cause`.
 *
 * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` when the pattern is not valid
 *   in JavaScript's dialect with the `u` flag.
 */
export function compileRegex(pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new FhirPathEvaluationError(
        'eval/invalid-argument',
        `The regular expression is not valid: ${reasonOf(error, pattern, flags)}`,
      );
    }
    throw error;
  }
}

/**
 * The engine's reason for rejecting the pattern. V8 writes `Invalid regular expression:
 * /pattern/flags: reason`; the reason is what is left after that prefix. Another engine, or a
 * pattern that V8 writes differently, gets a general reason.
 */
function reasonOf(error: SyntaxError, pattern: string, flags: string): string {
  const prefix = `Invalid regular expression: /${pattern}/${flags}: `;
  return error.message.startsWith(prefix)
    ? error.message.slice(prefix.length)
    : 'it is not valid JavaScript syntax with the u flag';
}

/**
 * The text that replaces one match of `replaceMatches()`: `substitution` with its group
 * references filled in. A reference is one of
 *
 * - `${name}` and `${n}`: the named group, or numbered group `n` (`${0}` is the whole match).
 *   This is the form of the spec's own example, `'${day}-${month}-${year}'`.
 * - JavaScript's replacement patterns: `$1`–`$99`, `$<name>`, `$&` (the whole match), `` $` ``
 *   (the text before it), `$'` (the text after it) and `$$` (a dollar sign). As in JavaScript, `$n`
 *   without a group `n` and `$<` without named groups are plain text.
 *
 * A group that did not take part in the match is empty. Any other `$` is plain text.
 *
 * @param match - The match, from `String.prototype.matchAll()`.
 * @param input - The text that was matched.
 * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` for a `${…}` reference to a
 *   group that the regular expression does not have. It is raised when a match is replaced, so a
 *   text without matches never raises it.
 */
export function expandSubstitution(
  substitution: string,
  match: RegExpMatchArray,
  input: string,
): string {
  let result = '';
  let position = 0;
  for (
    let dollar = substitution.indexOf('$');
    dollar !== -1;
    dollar = substitution.indexOf('$', position)
  ) {
    result += substitution.slice(position, dollar);
    const reference = referenceAt(substitution, dollar, match, input);
    result += reference.text;
    position = reference.end;
  }
  return result + substitution.slice(position);
}

interface Reference {
  /** What the reference stands for. A `$` that is not a reference stands for itself. */
  readonly text: string;
  /** The offset after the reference. */
  readonly end: number;
}

function referenceAt(
  substitution: string,
  dollar: number,
  match: RegExpMatchArray,
  input: string,
): Reference {
  const next = substitution.charAt(dollar + 1);
  const whole = match[0];
  const index = match.index ?? 0;
  switch (next) {
    case '$':
      return { text: '$', end: dollar + 2 };
    case '&':
      return { text: whole, end: dollar + 2 };
    case '`':
      return { text: input.slice(0, index), end: dollar + 2 };
    case "'":
      return { text: input.slice(index + whole.length), end: dollar + 2 };
    case '<':
      return namedReference(substitution, dollar, match);
    case '{':
      return bracedReference(substitution, dollar, match);
    default:
      return numberedReference(substitution, dollar, match);
  }
}

/** `$<name>`: JavaScript's form. It is plain text unless the pattern has named groups. */
function namedReference(substitution: string, dollar: number, match: RegExpMatchArray): Reference {
  const close = substitution.indexOf('>', dollar + 2);
  if (match.groups === undefined || close === -1) {
    return { text: '$', end: dollar + 1 };
  }
  const name = substitution.slice(dollar + 2, close);
  return { text: groupNamed(match, name) ?? '', end: close + 1 };
}

/** `${name}` and `${n}`: the form of the spec's example. */
function bracedReference(substitution: string, dollar: number, match: RegExpMatchArray): Reference {
  const close = substitution.indexOf('}', dollar + 2);
  if (close === -1) {
    return { text: '$', end: dollar + 1 };
  }
  const name = substitution.slice(dollar + 2, close);
  if (/^[0-9]+$/.test(name)) {
    if (Number(name) < match.length) {
      return { text: match[Number(name)] ?? '', end: close + 1 };
    }
  } else if (hasGroup(match, name)) {
    return { text: groupNamed(match, name) ?? '', end: close + 1 };
  }
  // The name is left out of the message: the substitution can be computed from input data.
  throw new FhirPathEvaluationError(
    'eval/invalid-argument',
    'The substitution refers to a group that the regular expression does not have',
  );
}

/** `$n` and `$nn`: JavaScript's form. It is plain text without a group of that number. */
function numberedReference(
  substitution: string,
  dollar: number,
  match: RegExpMatchArray,
): Reference {
  const groupCount = match.length - 1;
  const first = substitution.charAt(dollar + 1);
  if (first < '0' || first > '9') {
    return { text: '$', end: dollar + 1 };
  }
  const second = substitution.charAt(dollar + 2);
  if (second >= '0' && second <= '9') {
    const two = Number(first + second);
    if (two >= 1 && two <= groupCount) {
      return { text: match[two] ?? '', end: dollar + 3 };
    }
  }
  const one = Number(first);
  if (one >= 1 && one <= groupCount) {
    return { text: match[one] ?? '', end: dollar + 2 };
  }
  return { text: '$', end: dollar + 1 };
}

function hasGroup(match: RegExpMatchArray, name: string): boolean {
  return match.groups !== undefined && Object.hasOwn(match.groups, name);
}

/** The text of the named group, or undefined when it has none or did not take part. */
function groupNamed(match: RegExpMatchArray, name: string): string | undefined {
  return hasGroup(match, name) ? match.groups?.[name] : undefined;
}
