/**
 * Typed comparison of a result collection with a test's expected outputs. The rules are written
 * up in `tools/conformance/README.md` and, where they interpret the suite, in `docs/spec-notes.md`.
 */
import type { ResultItem } from './adapter.ts';
import type { ExpectedOutput, OutputType } from './suite.ts';

/**
 * The output type of each result type. System types map to the output type of the same name; a
 * FHIR primitive maps to its own name, as the HL7 Java runner uses `fhirType()`. Types the suite's
 * output types do not name (`uri`, `instant`, `Age`, complex types, resources) map to nothing and
 * never match a typed output.
 */
const OUTPUT_TYPE_OF: Readonly<Record<string, OutputType>> = {
  'System.Boolean': 'boolean',
  'System.Integer': 'integer',
  'System.Decimal': 'decimal',
  'System.String': 'string',
  'System.Date': 'date',
  'System.DateTime': 'dateTime',
  'System.Time': 'time',
  'System.Quantity': 'Quantity',
  'FHIR.boolean': 'boolean',
  'FHIR.integer': 'integer',
  'FHIR.decimal': 'decimal',
  'FHIR.string': 'string',
  'FHIR.code': 'code',
  'FHIR.id': 'id',
  'FHIR.date': 'date',
  'FHIR.dateTime': 'dateTime',
  'FHIR.time': 'time',
  'FHIR.Quantity': 'Quantity',
};

/** How values of each output type are compared. */
type ValueKind = 'boolean' | 'integer' | 'decimal' | 'string' | 'temporal' | 'quantity';

const VALUE_KIND: Readonly<Record<OutputType, ValueKind>> = {
  boolean: 'boolean',
  integer: 'integer',
  decimal: 'decimal',
  string: 'string',
  code: 'string',
  id: 'string',
  date: 'temporal',
  dateTime: 'temporal',
  time: 'temporal',
  Quantity: 'quantity',
};

/** The output type a result item counts as, if any. */
export function outputTypeOf(item: ResultItem): OutputType | undefined {
  return Object.hasOwn(OUTPUT_TYPE_OF, item.type) ? OUTPUT_TYPE_OF[item.type] : undefined;
}

/**
 * Whether a result collection matches the expected outputs: same length, and each item matches
 * its expected output, in order unless `ordered` is false.
 */
export function outputsMatch(
  expected: readonly ExpectedOutput[],
  actual: readonly ResultItem[],
  ordered: boolean,
): boolean {
  if (expected.length !== actual.length) {
    return false;
  }
  if (ordered) {
    return expected.every((output, i) => {
      const item = actual[i];
      return item !== undefined && itemMatches(output, item);
    });
  }
  return isPerfectMatching(expected, actual);
}

/**
 * Whether one result item matches one expected output: the same type, and the same value. An
 * output with empty text checks only the type, and an output without a type only the value, as
 * in the HL7 Java runner.
 */
export function itemMatches(expected: ExpectedOutput, actual: ResultItem): boolean {
  const actualType = outputTypeOf(actual);
  if (expected.type === undefined) {
    return (
      expected.text === '' ||
      (actualType !== undefined && untypedMatches(expected.text, actualType, actual))
    );
  }
  if (actualType !== expected.type) {
    return false;
  }
  return expected.text === '' || valuesMatch(VALUE_KIND[expected.type], expected.text, actual);
}

/**
 * `predicate="true"`: the result as a Boolean. A single Boolean stays as it is; otherwise the
 * result is `true` when it is not empty.
 */
export function toPredicate(actual: readonly ResultItem[]): ResultItem[] {
  const [only] = actual;
  if (actual.length === 1 && only !== undefined && outputTypeOf(only) === 'boolean') {
    return [{ type: 'System.Boolean', value: only.value ?? 'false' }];
  }
  return [{ type: 'System.Boolean', value: String(actual.length > 0) }];
}

/** An expected output for messages and diffs, for example `decimal 1.50` or `string "a"`. */
export function formatExpected(expected: ExpectedOutput): string {
  if (expected.type === undefined) {
    return `${expected.text} (untyped)`;
  }
  return `${expected.type} ${formatValue(expected.type, expected.text)}`;
}

/**
 * A result item in the same form as {@link formatExpected}. Items of a type that no output type
 * names are shown with their own type, for example `FHIR.uri http://x` or `FHIR.HumanName`.
 */
export function formatActual(actual: ResultItem): string {
  const outputType = outputTypeOf(actual);
  if (outputType === undefined || actual.value === undefined) {
    return actual.value === undefined ? actual.type : `${actual.type} ${actual.value}`;
  }
  const text = outputType === 'Quantity' ? `${actual.value} '${actual.unit ?? ''}'` : actual.value;
  return `${outputType} ${formatValue(outputType, text)}`;
}

function formatValue(type: OutputType, text: string): string {
  switch (VALUE_KIND[type]) {
    case 'string':
      return JSON.stringify(text);
    case 'temporal':
      return `@${type === 'time' ? 'T' : ''}${normalizeTemporal(text)}`;
    default:
      return text.trim();
  }
}

function valuesMatch(kind: ValueKind, expected: string, actual: ResultItem): boolean {
  if (actual.value === undefined) {
    return false;
  }
  const value = actual.value;
  switch (kind) {
    case 'boolean':
      return expected.trim() === value;
    case 'integer':
      return integersEqual(expected.trim(), value);
    case 'decimal':
      return decimalsEqual(expected.trim(), value);
    case 'string':
      return expected === value;
    case 'temporal':
      return normalizeTemporal(expected) === normalizeTemporal(value);
    case 'quantity': {
      const quantity = parseQuantity(expected.trim());
      return (
        quantity !== undefined &&
        decimalsEqual(quantity.value, value) &&
        quantity.unit === (actual.unit ?? '')
      );
    }
    default:
      return assertNever(kind);
  }
}

/**
 * Untyped outputs (R4 only) hold a FHIRPath literal. The literal decides the kind of value; the
 * result type only has to be of the same kind (an integer or decimal for a number, a date, dateTime
 * or time for a date/time literal, and so on).
 */
function untypedMatches(text: string, actualType: OutputType, actual: ResultItem): boolean {
  const literal = text.trim();
  const actualKind = VALUE_KIND[actualType];
  if (literal === 'true' || literal === 'false') {
    return actualKind === 'boolean' && valuesMatch('boolean', literal, actual);
  }
  if (literal.startsWith('@')) {
    return actualKind === 'temporal' && valuesMatch('temporal', literal, actual);
  }
  if (literal.startsWith("'")) {
    const string = unquote(literal);
    return string !== undefined && actualKind === 'string' && valuesMatch('string', string, actual);
  }
  if (DECIMAL.test(literal)) {
    return (
      (actualKind === 'integer' || actualKind === 'decimal') &&
      decimalsEqual(literal, actual.value ?? '')
    );
  }
  return actualKind === 'quantity' && valuesMatch('quantity', literal, actual);
}

const INTEGER = /^[+-]?\d+$/;
const DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?$/;
const QUANTITY = /^([+-]?\d+(?:\.\d+)?)\s*(?:'((?:[^'\\]|\\.)*)'|([A-Za-z]+))$/;

function integersEqual(a: string, b: string): boolean {
  return INTEGER.test(a) && INTEGER.test(b) && BigInt(a) === BigInt(b);
}

/**
 * Decimals are equal when they have the same value and the same number of decimal places, so
 * `1.50` ≠ `1.5` (precision is observable in FHIRPath). `-0.0` equals `0.0`.
 */
export function decimalsEqual(a: string, b: string): boolean {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  return (
    left !== undefined &&
    right !== undefined &&
    left.scale === right.scale &&
    left.coefficient === right.coefficient
  );
}

function parseDecimal(text: string): { coefficient: bigint; scale: number } | undefined {
  const match = DECIMAL.exec(text);
  if (match === null) {
    return undefined;
  }
  const [, sign = '', whole = '', fraction = ''] = match;
  const magnitude = BigInt(`${whole}${fraction}`);
  return { coefficient: sign === '-' ? -magnitude : magnitude, scale: fraction.length };
}

/** Drops the `@` and `T` literal prefixes. */
function normalizeTemporal(text: string): string {
  const value = text.trim();
  const date = value.startsWith('@') ? value.slice(1) : value;
  return date.startsWith('T') ? date.slice(1) : date;
}

function parseQuantity(text: string): { value: string; unit: string } | undefined {
  const match = QUANTITY.exec(text);
  if (match === null) {
    return undefined;
  }
  const [, value = '', quoted, word] = match;
  const unit = quoted === undefined ? word : unquote(`'${quoted}'`);
  return unit === undefined ? undefined : { value, unit };
}

/** The value of a FHIRPath string literal, or undefined if it is not one (https://hl7.org/fhirpath/N1/#string). */
function unquote(literal: string): string | undefined {
  if (literal.length < 2 || !literal.startsWith("'") || !literal.endsWith("'")) {
    return undefined;
  }
  return literal.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, sequence: string) => {
    if (sequence.startsWith('u') && sequence.length === 5) {
      return String.fromCharCode(Number.parseInt(sequence.slice(1), 16));
    }
    return ESCAPES[sequence] ?? sequence;
  });
}

const ESCAPES: Readonly<Record<string, string>> = { f: '\f', n: '\n', r: '\r', t: '\t' };

/** Whether every expected output can be paired with a different result item (Kuhn's algorithm). */
function isPerfectMatching(
  expected: readonly ExpectedOutput[],
  actual: readonly ResultItem[],
): boolean {
  const owner: (number | undefined)[] = actual.map(() => undefined);
  const tryAssign = (e: number, visited: boolean[]): boolean => {
    const output = expected[e];
    for (let a = 0; a < actual.length; a++) {
      const item = actual[a];
      if (visited[a] || output === undefined || item === undefined || !itemMatches(output, item)) {
        continue;
      }
      visited[a] = true;
      const current = owner[a];
      if (current === undefined || tryAssign(current, visited)) {
        owner[a] = e;
        return true;
      }
    }
    return false;
  };
  return expected.every((_, e) =>
    tryAssign(
      e,
      actual.map(() => false),
    ),
  );
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
