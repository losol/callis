/**
 * Lossless JSON input: a small parser that keeps every number as it is written
 * ([T0018: lossless decimals](https://github.com/losol/callis/blob/main/docs/tasks/T0018-model-aware-evaluation.md#lossless-decimals-in-json-input)).
 *
 * `JSON.parse` goes through JavaScript numbers, so `1.50` becomes `1.5` and `9.5e2` becomes `950`.
 * FHIRPath can see that difference (`toString()`, `~`, `precision()`), and FHIR asks
 * implementations to keep the precision of decimals. `parseJson()` returns ordinary objects, arrays,
 * strings, Booleans and `null`, and a {@link JsonNumber} for each number. Navigation and the output
 * adapters understand both forms, so a host can choose: convenient `JSON.parse` data, or exact
 * data from this parser.
 *
 * @see https://www.rfc-editor.org/rfc/rfc8259
 * @see https://hl7.org/fhir/R4/json.html#primitive
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { Decimal, isWithinDecimalBounds, MAX_DECIMAL_DIGITS } from '../values/decimal/decimal.ts';

/** The parts of a JSON number: sign, integer digits, fraction digits and exponent. */
const NUMBER_PARTS = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/;

/** A JSON number token at the current position ([RFC 8259 §6](https://www.rfc-editor.org/rfc/rfc8259#section-6)). */
const NUMBER_TOKEN = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

/** The 32-bit range of `System.Integer` ([N1 §4.1](https://hl7.org/fhirpath/N1/#literals)). */
const MIN_INTEGER = -(2 ** 31);
const MAX_INTEGER = 2 ** 31 - 1;

/**
 * A JSON number as written in the input, such as `1.50` or `9.5e2`.
 *
 * {@link parseJson} creates one for every number. In a FHIRPath evaluation it behaves as the
 * Integer or Decimal its text denotes, with the precision of the text. `valueOf()` and `toJSON()`
 * give the nearest JavaScript number, so arithmetic and `JSON.stringify()` treat it like the
 * number `JSON.parse` would have produced; `toString()` gives the text.
 */
export class JsonNumber {
  /** The number exactly as written. */
  readonly text: string;

  /**
   * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` if `text` is not a JSON number.
   */
  constructor(text: string) {
    if (typeof text !== 'string' || !NUMBER_PARTS.test(text)) {
      throw new FhirPathEvaluationError(
        'eval/invalid-argument',
        `Expected a JSON number, but found ${JSON.stringify(text)}`,
      );
    }
    this.text = text;
    Object.freeze(this);
  }

  /**
   * The value as a `System.Integer`: a number written without a fraction or an exponent, within
   * the 32-bit range. Undefined otherwise (`1.0` and `1e2` are Decimals), so a FHIR `decimal`
   * never turns into an Integer by accident. `-0` is `0`.
   */
  toInteger(): number | undefined {
    if (this.text.includes('.') || this.text.includes('e') || this.text.includes('E')) {
      return undefined;
    }
    const value = Number(this.text);
    // `+ 0` turns a JSON `-0` into `0`, so no negative zero leaks into a collection.
    return value >= MIN_INTEGER && value <= MAX_INTEGER ? value + 0 : undefined;
  }

  /**
   * The value as a `System.Decimal`, keeping the digits of the text: `1.50` has scale 2, and
   * `9.5e2` is `950`. Undefined when the value is outside the Decimal size bound
   * ([T0004](https://github.com/losol/callis/blob/main/docs/tasks/T0004-decimal.md#design-notes)).
   */
  toDecimal(): Decimal | undefined {
    const match = NUMBER_PARTS.exec(this.text);
    if (match === null) {
      return undefined;
    }
    const [, sign = '', integer = '', fraction = '', exponent] = match;
    if (exponent === undefined) {
      return Decimal.parse(this.text);
    }
    const digits = (integer + fraction).replace(/^0+(?=.)/, '');
    const scale = fraction.length - Number(exponent);
    // Checked on the text, so an oversized number never becomes a BigInt: a huge exponent would
    // need more digits than any Decimal may have.
    if (scale > MAX_DECIMAL_DIGITS) {
      return undefined;
    }
    if (digits === '0') {
      return Decimal.of(0n, Math.max(scale, 0));
    }
    if (digits.length > MAX_DECIMAL_DIGITS || digits.length - scale > MAX_DECIMAL_DIGITS) {
      return undefined;
    }
    const magnitude = scale >= 0 ? BigInt(digits) : BigInt(digits) * 10n ** BigInt(-scale);
    const coefficient = sign === '-' ? -magnitude : magnitude;
    const finalScale = Math.max(scale, 0);
    return isWithinDecimalBounds(coefficient, finalScale)
      ? Decimal.of(coefficient, finalScale)
      : undefined;
  }

  /** The nearest JavaScript number, as `JSON.parse` would give. It can lose precision. */
  toNumber(): number {
    return Number(this.text);
  }

  /** The nearest JavaScript number, so `+`, `<` and `Number()` work on it. */
  valueOf(): number {
    return this.toNumber();
  }

  /** The nearest JavaScript number, so `JSON.stringify()` writes it as a number again. */
  toJSON(): number {
    return this.toNumber();
  }

  /** The text as written. */
  toString(): string {
    return this.text;
  }
}

/** A JSON value from {@link parseJson}: ordinary values, with every number as a {@link JsonNumber}. */
export type JsonValue =
  | null
  | boolean
  | string
  | JsonNumber
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type Frame =
  | { readonly kind: 'array'; readonly items: JsonValue[] }
  | { readonly kind: 'object'; readonly object: Record<string, JsonValue>; key: string };

/**
 * Parses JSON text, keeping each number as a {@link JsonNumber} that holds its source text.
 *
 * Accepts exactly what [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259) allows, like
 * `JSON.parse`: no comments, trailing commas or `NaN`. Objects are ordinary objects with the keys
 * in document order; a `__proto__` key becomes an own property and never changes the prototype.
 * Nesting depth is not limited by the call stack. The result is not frozen, but navigation never
 * changes it.
 *
 * @example
 * ```ts
 * const input = parseJson('{"resourceType": "Observation", "valueQuantity": {"value": 1.50}}');
 * evaluate(input, 'valueQuantity.value', { decimalOutput: 'string' }); // ['1.50']
 * ```
 *
 * @throws {@link FhirPathEvaluationError} `eval/invalid-json` for text that is not JSON, with
 *   the offset of the problem in the message.
 */
export function parseJson(text: string): JsonValue {
  if (typeof text !== 'string') {
    throw new FhirPathEvaluationError('eval/invalid-json', 'Expected JSON text as a string');
  }
  const parser = new Parser(text);
  return parser.parse();
}

/** The character codes the parser dispatches on. */
const Char = {
  Tab: 0x09,
  LineFeed: 0x0a,
  CarriageReturn: 0x0d,
  Space: 0x20,
  Quote: 0x22,
  Comma: 0x2c,
  Colon: 0x3a,
  OpenBracket: 0x5b,
  Backslash: 0x5c,
  CloseBracket: 0x5d,
  OpenBrace: 0x7b,
  CloseBrace: 0x7d,
} as const;

class Parser {
  readonly #text: string;
  #pos = 0;

  constructor(text: string) {
    this.#text = text;
  }

  parse(): JsonValue {
    const stack: Frame[] = [];
    this.skipWhitespace();
    for (;;) {
      // Read the start of a value. Containers are pushed and their first member is read next.
      let value: JsonValue;
      const code = this.#text.charCodeAt(this.#pos);
      if (code === Char.OpenBrace) {
        this.#pos++;
        this.skipWhitespace();
        if (this.#text.charCodeAt(this.#pos) === Char.CloseBrace) {
          this.#pos++;
          value = {};
        } else {
          stack.push({ kind: 'object', object: {}, key: this.readKey() });
          continue;
        }
      } else if (code === Char.OpenBracket) {
        this.#pos++;
        this.skipWhitespace();
        if (this.#text.charCodeAt(this.#pos) === Char.CloseBracket) {
          this.#pos++;
          value = [];
        } else {
          stack.push({ kind: 'array', items: [] });
          continue;
        }
      } else {
        value = this.readScalar();
      }
      // Place the value in its container, closing containers that end here.
      for (;;) {
        this.skipWhitespace();
        const frame = stack[stack.length - 1];
        if (frame === undefined) {
          if (this.#pos < this.#text.length) {
            throw this.unexpected();
          }
          return value;
        }
        if (frame.kind === 'array') {
          frame.items.push(value);
        } else {
          setProperty(frame.object, frame.key, value);
        }
        const next = this.#text.charCodeAt(this.#pos);
        if (next === Char.Comma) {
          this.#pos++;
          this.skipWhitespace();
          if (frame.kind === 'object') {
            frame.key = this.readKey();
          }
          break;
        }
        if (next === (frame.kind === 'array' ? Char.CloseBracket : Char.CloseBrace)) {
          this.#pos++;
          stack.pop();
          value = frame.kind === 'array' ? frame.items : frame.object;
          continue;
        }
        throw this.unexpected();
      }
    }
  }

  /** A string key followed by `:`, with the position left at the start of the value. */
  private readKey(): string {
    if (this.#text.charCodeAt(this.#pos) !== Char.Quote) {
      throw this.unexpected();
    }
    const key = this.readString();
    this.skipWhitespace();
    if (this.#text.charCodeAt(this.#pos) !== Char.Colon) {
      throw this.unexpected();
    }
    this.#pos++;
    this.skipWhitespace();
    return key;
  }

  private readScalar(): JsonValue {
    const text = this.#text;
    const pos = this.#pos;
    if (text.charCodeAt(pos) === Char.Quote) {
      return this.readString();
    }
    NUMBER_TOKEN.lastIndex = pos;
    const number = NUMBER_TOKEN.exec(text);
    if (number !== null) {
      this.#pos = NUMBER_TOKEN.lastIndex;
      return new JsonNumber(number[0]);
    }
    for (const [literal, value] of LITERALS) {
      if (text.startsWith(literal, pos)) {
        this.#pos = pos + literal.length;
        return value;
      }
    }
    throw this.unexpected();
  }

  /** A string, with the position at its opening quote. */
  private readString(): string {
    const text = this.#text;
    let pos = this.#pos + 1;
    let start = pos;
    let result = '';
    for (;;) {
      if (pos >= text.length) {
        throw this.error('unterminated string', pos);
      }
      const code = text.charCodeAt(pos);
      if (code === Char.Quote) {
        result += text.slice(start, pos);
        this.#pos = pos + 1;
        return result;
      }
      if (code === Char.Backslash) {
        result += text.slice(start, pos);
        const [escaped, length] = this.readEscape(pos);
        result += escaped;
        pos += length;
        start = pos;
        continue;
      }
      if (code < Char.Space) {
        throw this.error('a control character must be escaped', pos);
      }
      pos++;
    }
  }

  /** The character of an escape sequence starting at `pos`, and the length of the sequence. */
  private readEscape(pos: number): readonly [string, number] {
    const text = this.#text;
    const escaped = text[pos + 1];
    switch (escaped) {
      case '"':
      case '\\':
      case '/':
        return [escaped, 2];
      case 'b':
        return ['\b', 2];
      case 'f':
        return ['\f', 2];
      case 'n':
        return ['\n', 2];
      case 'r':
        return ['\r', 2];
      case 't':
        return ['\t', 2];
      case 'u': {
        const hex = text.slice(pos + 2, pos + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw this.error('invalid unicode escape', pos);
        }
        return [String.fromCharCode(Number.parseInt(hex, 16)), 6];
      }
      default:
        throw this.error('invalid escape sequence', pos);
    }
  }

  private skipWhitespace(): void {
    const text = this.#text;
    let pos = this.#pos;
    for (;;) {
      const code = text.charCodeAt(pos);
      if (
        code === Char.Space ||
        code === Char.LineFeed ||
        code === Char.CarriageReturn ||
        code === Char.Tab
      ) {
        pos++;
      } else {
        this.#pos = pos;
        return;
      }
    }
  }

  private unexpected(): FhirPathEvaluationError {
    const pos = this.#pos;
    if (pos >= this.#text.length) {
      return this.error('unexpected end of input', pos);
    }
    return this.error(`unexpected character ${JSON.stringify(this.#text[pos])}`, pos);
  }

  private error(problem: string, pos: number): FhirPathEvaluationError {
    return new FhirPathEvaluationError(
      'eval/invalid-json',
      `Invalid JSON: ${problem} at position ${pos}`,
    );
  }
}

const LITERALS: ReadonlyArray<readonly [string, JsonValue]> = [
  ['true', true],
  ['false', false],
  ['null', null],
];

/**
 * Sets an own property, as `JSON.parse` does: a later duplicate key wins, and `__proto__` is an
 * own property rather than the prototype.
 */
function setProperty(object: Record<string, JsonValue>, key: string, value: JsonValue): void {
  if (key === '__proto__') {
    Object.defineProperty(object, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } else {
    object[key] = value;
  }
}
