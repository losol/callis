import { Decimal } from '../decimal/decimal.ts';
import { Quantity } from './quantity.ts';

/**
 * Maps FHIR Quantity JSON with a UCUM system/code to System.Quantity, without unit validation.
 * Accepts Decimal values for lossless JSON adapters as well as ordinary JSON numbers; `readValue`
 * reads other value representations, such as the lossless JSON numbers of `parseJson()`.
 * Only the six time codes explicitly listed by FHIR are mapped to calendar keywords;
 * wk/ms remain UCUM units. Display unit text is not a substitute for code.
 * @see https://hl7.org/fhir/R5/fhirpath.html#quantity
 */
export function fromFhirQuantity(
  json: unknown,
  readValue: (value: unknown) => Decimal | undefined = decimalValue,
): Quantity | undefined {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return undefined;
  if (
    !Object.hasOwn(json, 'system') ||
    !('system' in json) ||
    json.system !== 'http://unitsofmeasure.org'
  )
    return undefined;
  if (
    !Object.hasOwn(json, 'code') ||
    !('code' in json) ||
    typeof json.code !== 'string' ||
    json.code.length === 0
  )
    return undefined;
  if (!Object.hasOwn(json, 'value') || !('value' in json)) return undefined;
  const value = readValue(json.value);
  if (value === undefined) return undefined;
  let unit = json.code;
  switch (unit) {
    case 'a':
      unit = 'year';
      break;
    case 'mo':
      unit = 'month';
      break;
    case 'd':
      unit = 'day';
      break;
    case 'h':
      unit = 'hour';
      break;
    case 'min':
      unit = 'minute';
      break;
    case 's':
      unit = 'second';
      break;
  }
  return new Quantity(value, unit);
}

/** The default value reader: a `Decimal` as it is, a JSON number through `Decimal.fromNumber()`. */
function decimalValue(value: unknown): Decimal | undefined {
  if (value instanceof Decimal) return value;
  return typeof value === 'number' ? Decimal.fromNumber(value) : undefined;
}
