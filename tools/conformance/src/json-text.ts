/**
 * JSON values that keep each number as written, for the converted fixtures (T0023).
 *
 * `JSON.parse` and `JSON.stringify` go through JavaScript numbers, so `1.50` would become `1.5` and
 * `9.5e2` would become `950`. FHIRPath can see that difference (`toString()`, `precision()`, `~`),
 * so the converter writes each FHIR `decimal` and `integer` with the exact text of the XML value.
 */

/** A JSON number token: `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?` ([RFC 8259 §6](https://www.rfc-editor.org/rfc/rfc8259#section-6)). */
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** A JSON number, kept as its text. */
export class NumberLexeme {
  /** The number as written, such as `1.50` or `9.5e2`. */
  readonly text: string;

  constructor(text: string) {
    if (!JSON_NUMBER.test(text)) {
      throw new RangeError(`not a JSON number: ${text}`);
    }
    this.text = text;
  }
}

/** A JSON object, with its properties in the order they are written. */
export type JsonObject = ReadonlyMap<string, JsonValue>;

/** A JSON value whose numbers keep their text. */
export type JsonValue = null | boolean | string | NumberLexeme | readonly JsonValue[] | JsonObject;

/** Whether a text is a JSON number token. */
export function isJsonNumber(text: string): boolean {
  return JSON_NUMBER.test(text);
}

/**
 * Writes a value as JSON, laid out as `JSON.stringify(value, null, 2)` would, with a trailing line
 * break. Numbers are written as their text.
 */
export function stringifyJson(value: JsonValue): string {
  return `${write(value, '')}\n`;
}

function write(value: JsonValue, indent: string): string {
  if (value instanceof NumberLexeme) return value.text;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  const inner = `${indent}  `;
  if (isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => `${inner}${write(item, inner)}`);
    return `[\n${items.join(',\n')}\n${indent}]`;
  }
  if (value.size === 0) return '{}';
  const members = [...value].map(
    ([key, member]) => `${inner}${JSON.stringify(key)}: ${write(member, inner)}`,
  );
  return `{\n${members.join(',\n')}\n${indent}}`;
}

// Array.isArray does not narrow a readonly array type.
function isArray(value: readonly JsonValue[] | JsonObject): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/**
 * Parses JSON text into plain values, with every number replaced by a {@link NumberLexeme} that
 * holds its source text. For tests that compare converted JSON without losing precision.
 */
export function parseJsonKeepingNumbers(text: string): unknown {
  // The reviver's third argument is the source text of a primitive (ES2025 JSON.parse source
  // text access, in Node.js 21 and later).
  return JSON.parse(
    text,
    (_key: string, value: unknown, context?: { readonly source?: string }) => {
      if (typeof value !== 'number') return value;
      if (context?.source === undefined) {
        throw new Error('JSON.parse source text access is not available in this runtime');
      }
      return new NumberLexeme(context.source);
    },
  );
}
