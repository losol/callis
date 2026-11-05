/**
 * Builds System values from FHIRPath literal text, so kernel tests can be written as the spec and
 * the HL7 suite write them (`1.10`, `@2012-04-15`, `7 days`, `1 'wk'`) before the compiler exists.
 * Only the literal forms the tests need are supported; anything else throws.
 */
import type { Item } from '../../src/runtime/collection.ts';
import { parseTemporalLiteral } from '../../src/values/datetime/parse.ts';
import { Decimal } from '../../src/values/decimal/decimal.ts';
import { Quantity } from '../../src/values/quantity/quantity.ts';

const INTEGER = /^-?\d+$/;
const DECIMAL = /^-?\d+\.\d+$/;
const STRING = /^'([^'\\]*)'$/;
const QUANTITY = /^(-?\d+(?:\.\d+)?) (?:'([^']*)'|([a-z]+))$/;

/**
 * The value of a literal: `true`/`false`, an Integer (`1`), a Decimal (`1.0`), a String (`'a'`,
 * without escapes), a date/time (`@2012`, `@T10:00`) or a Quantity (`7 days`, `1 'wk'`).
 */
export function literal(text: string): Item {
  if (text === 'true' || text === 'false') {
    return text === 'true';
  }
  if (INTEGER.test(text)) {
    return Number(text);
  }
  if (DECIMAL.test(text)) {
    return decimal(text);
  }
  const string = STRING.exec(text);
  if (string !== null) {
    return string[1] ?? '';
  }
  if (text.startsWith('@')) {
    const value = parseTemporalLiteral(text);
    if (value === undefined) {
      throw new Error(`Invalid date/time literal in test: ${text}`);
    }
    return value;
  }
  const quantity = QUANTITY.exec(text);
  if (quantity !== null) {
    return new Quantity(decimal(quantity[1] ?? ''), quantity[2] ?? quantity[3]);
  }
  throw new Error(`Unsupported literal in test: ${text}`);
}

/** A Decimal from its text. */
export function decimal(text: string): Decimal {
  const value = Decimal.parse(text);
  if (value === undefined) {
    throw new Error(`Invalid decimal in test: ${text}`);
  }
  return value;
}
