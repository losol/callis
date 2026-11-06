/**
 * Output adapters: how result collections are handed to the caller
 * ([T0025: output modes](https://github.com/losol/callis/blob/main/docs/tasks/T0025-public-api-release.md#public-api-sketch),
 * [ADR-0012](https://github.com/losol/callis/blob/main/docs/adr/0012-evaluation-defaults.md)).
 * These are the basic versions; T0025 finishes them.
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { ModelNode } from '../model/model-node.ts';
import type { Collection, Item } from '../runtime/collection.ts';
import { UCUM_URL } from '../runtime/variables.ts';
import { DateValue } from '../values/datetime/date.ts';
import { DateTimeValue } from '../values/datetime/datetime.ts';
import { TimeValue } from '../values/datetime/time.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { isCalendarUnit } from '../values/quantity/calendar-units.ts';
import { Quantity } from '../values/quantity/quantity.ts';

/**
 * - `plain`: JSON-friendly JavaScript values.
 * - `typed`: the Callis values themselves (`Decimal`, `DateTimeValue`, `Quantity`, `ModelNode`),
 *   without loss.
 */
export type OutputMode = 'plain' | 'typed';

/** How Decimals appear in plain output: as a `number` (the default) or as exact text. */
export type DecimalOutput = 'number' | 'string';

/** The output options of an evaluation. */
export interface OutputOptions {
  readonly output?: OutputMode;
  readonly decimalOutput?: DecimalOutput;
}

/** A Quantity in plain output, shaped like a FHIR `Quantity`. */
export interface PlainQuantity {
  readonly value: number | string;
  readonly unit: string;
  /** `http://unitsofmeasure.org` for a UCUM unit; absent for a calendar duration keyword. */
  readonly system?: string;
  /** The UCUM code; absent for a calendar duration keyword. */
  readonly code?: string;
}

/**
 * Converts a result collection for the caller.
 *
 * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` for an unknown `output` or
 *   `decimalOutput` option.
 */
export function toOutput(items: Collection, options: OutputOptions = {}): unknown[] {
  const output = options.output ?? 'plain';
  const decimalOutput = options.decimalOutput ?? 'number';
  if (output !== 'plain' && output !== 'typed') {
    throw invalidOption('output', String(output));
  }
  if (decimalOutput !== 'number' && decimalOutput !== 'string') {
    throw invalidOption('decimalOutput', String(decimalOutput));
  }
  if (output === 'typed') {
    return [...items];
  }
  const values: unknown[] = [];
  for (const item of items) {
    const value = toPlainValue(item, decimalOutput);
    if (value !== undefined) {
      values.push(value);
    }
  }
  return values;
}

/**
 * The plain form of one item:
 *
 * - Boolean, String and Integer as JavaScript primitives
 * - Decimal as a `number`, or as its exact text with `decimalOutput: 'string'`
 * - Date, DateTime and Time as FHIR-formatted strings, without `@`
 * - Quantity as `{ value, unit, system?, code? }`
 * - input nodes as the JSON they hold; a primitive with only extensions as its `_name` object
 *
 * Undefined only for a node that holds nothing.
 */
export function toPlainValue(item: Item, decimalOutput: DecimalOutput = 'number'): unknown {
  if (item instanceof ModelNode) {
    return item.value !== undefined ? item.value : item.primitiveElement;
  }
  if (item instanceof Decimal) {
    return plainDecimal(item, decimalOutput);
  }
  if (item instanceof DateValue || item instanceof DateTimeValue || item instanceof TimeValue) {
    return item.toString();
  }
  if (item instanceof Quantity) {
    const value = plainDecimal(item.value, decimalOutput);
    const quantity: PlainQuantity = isCalendarUnit(item.unit)
      ? { value, unit: item.unit }
      : { value, unit: item.unit, system: UCUM_URL, code: item.unit };
    return quantity;
  }
  return item;
}

function plainDecimal(value: Decimal, decimalOutput: DecimalOutput): number | string {
  return decimalOutput === 'string' ? value.toString() : value.toNumber();
}

function invalidOption(name: string, value: string): FhirPathEvaluationError {
  return new FhirPathEvaluationError(
    'eval/invalid-argument',
    `The ${name} option cannot be ${JSON.stringify(value)}`,
  );
}
