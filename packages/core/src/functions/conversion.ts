/**
 * The conversion functions ([N1 §5.5](https://hl7.org/fhirpath/N1/#conversion), as clarified in
 * [3.0.0](https://hl7.org/fhirpath/STU3/en/index.html#conversion)): `iif()`, and for each of
 * Boolean, Integer, Decimal, Date, DateTime, Time, String and Quantity a `toX()` that converts the
 * single input item and a `convertsToX()` that says whether it would.
 *
 * Every function takes at most one input item: more than one raises `eval/singleton-expected`, and
 * empty input gives empty. An input node is converted through its System value, so
 * `Patient.birthDate.toString()` reads the `FHIR.date` as a `System.Date`, the same way with every
 * model ([T0018](https://github.com/losol/callis/blob/main/docs/tasks/T0018-model-aware-evaluation.md#modelnode)).
 * A node that holds no value, a FHIR primitive with only extensions, has nothing to convert:
 * `toX()` and `convertsToX()` both give empty for it, as for empty input.
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import {
  type Collection,
  EMPTY,
  fromBoolean,
  fromOptional,
  type Item,
} from '../runtime/collection.ts';
import { asBoolean } from '../runtime/item-conversion.ts';
import { andThen, type MaybePromise } from '../runtime/maybe-promise.ts';
import { toSystemValue } from '../runtime/node-value.ts';
import { asQuantity } from '../runtime/operands.ts';
import { singleton } from '../runtime/singleton.ts';
import type { SystemTypeName } from '../types/system-types.ts';
import { DateValue } from '../values/datetime/date.ts';
import { DateTimeValue } from '../values/datetime/datetime.ts';
import { parseDate, parseDateTime, parseTime } from '../values/datetime/parse.ts';
import { TimeValue } from '../values/datetime/time.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { isCalendarUnit } from '../values/quantity/calendar-units.ts';
import { Quantity } from '../values/quantity/quantity.ts';
import {
  type CallContext,
  defineFunction,
  defineValueFunction,
  type FunctionDefinition,
  lambdaArg,
  type ParamSpec,
} from './define.ts';

/** The 32-bit range of `System.Integer` ([N1 §4.1](https://hl7.org/fhirpath/N1/#literals)). */
const MIN_INTEGER = -(2 ** 31);
const MAX_INTEGER = 2 ** 31 - 1;

/** The Integer string format of `toInteger()`: `(\+|-)?\d+`, with ASCII digits only. */
const INTEGER_TEXT = /^[+-]?[0-9]+$/;

/**
 * The Quantity string format of `toQuantity()`, anchored:
 * `(?'value'(\+|-)?\d+(\.\d+)?)\s*('(?'unit'[^']+)'|(?'time'[a-zA-Z]+))?`. The groups are the
 * value, a quoted UCUM unit and an unquoted calendar keyword. No quantifier overlaps the next one,
 * so matching is linear in the input.
 */
const QUANTITY_TEXT = /^([+-]?[0-9]+(?:\.[0-9]+)?)\s*(?:'([^']+)'|([a-zA-Z]+))?$/;

/**
 * The strings `toBoolean()` accepts, in lower case; case is ignored
 * ([N1 §5.5.2](https://hl7.org/fhirpath/N1/#toboolean-boolean)).
 */
const BOOLEAN_TEXT: ReadonlyMap<string, boolean> = new Map([
  ['true', true],
  ['t', true],
  ['yes', true],
  ['y', true],
  ['1', true],
  ['1.0', true],
  ['false', false],
  ['f', false],
  ['no', false],
  ['n', false],
  ['0', false],
  ['0.0', false],
]);

/** `true.toDecimal()` is `1.0` and `false.toDecimal()` is `0.0`, with one decimal place. */
const DECIMAL_TRUE = Decimal.of(10n, 1);
const DECIMAL_FALSE = Decimal.of(0n, 1);

/**
 * Converts one System value, or returns undefined when it does not convert. `args` are the
 * evaluated arguments of the call, for `toQuantity(unit)`.
 */
type Conversion = (value: Item, args: readonly Collection[], call: CallContext) => Item | undefined;

/**
 * `iif(criterion, true-result [, otherwise-result])`: `true-result` when the criterion is true,
 * otherwise `otherwise-result`, or empty when it is left out. Only the selected branch is
 * evaluated, so `iif(true, 1, %undefined)` is `1` and raises no error for the variable.
 *
 * The input is the focus and `$this` of all three arguments, also when it is empty, and `$index`
 * stays that of the enclosing function: `('a').iif($this = 'a', 'yes')` is `'yes'`, and
 * `{}.iif(exists(), 'yes', 'no')` is `'no'`. Called without a target, the input is the focus where
 * the call is written. More than one input item raises `eval/singleton-expected`. The criterion
 * is a Boolean by singleton evaluation: empty counts as false, a single non-Boolean item as true,
 * and more than one item raises `eval/singleton-expected`.
 *
 * @see https://hl7.org/fhirpath/N1/#iifcriterion-expression-true-result-collection-otherwise-result-collection-collection
 * @see https://hl7.org/fhirpath/STU3/en/index.html#iifcriterion-this--boolean-true-result-this--collection--otherwise-result-this--collection--collection
 */
export const iifFunction: FunctionDefinition = defineFunction({
  name: 'iif',
  params: [
    { kind: 'lambda', name: 'criterion' },
    { kind: 'lambda', name: 'true-result' },
    { kind: 'lambda', name: 'otherwise-result', optional: true },
  ],
  impl: (_call, input, args) => {
    if (input.length > 1) {
      throw new FhirPathEvaluationError(
        'eval/singleton-expected',
        `Expected at most one input item for iif(), but found ${input.length} items`,
      );
    }
    // The registry checked the arity, so the criterion and the true-result are there.
    const criterion = lambdaArg(args, 0);
    return andThen(criterion?.forInput(input) ?? EMPTY, (result): MaybePromise<Collection> => {
      const isTrue = singleton(result, 'Boolean', asBoolean) === true;
      const branch = lambdaArg(args, isTrue ? 1 : 2);
      return branch === undefined ? EMPTY : branch.forInput(input);
    });
  },
});

/**
 * `toBoolean()`: a Boolean as it is; the Integers `1` and `0`, Decimals equal to `1.0` and `0.0`,
 * and the strings `'true'`, `'t'`, `'yes'`, `'y'`, `'1'`, `'1.0'` and `'false'`, `'f'`, `'no'`,
 * `'n'`, `'0'`, `'0.0'` in any case, as true and false. Anything else is empty.
 *
 * @see https://hl7.org/fhirpath/N1/#toboolean-boolean
 * @see https://hl7.org/fhirpath/STU3/en/index.html#toboolean--boolean
 */
export const toBooleanFunction: FunctionDefinition = conversionFunction(
  'toBoolean',
  'Boolean',
  convertToBoolean,
);

/**
 * `convertsToBoolean()`: whether `toBoolean()` gives a value.
 *
 * @see https://hl7.org/fhirpath/N1/#convertstoboolean-boolean
 */
export const convertsToBooleanFunction: FunctionDefinition = convertsToFunction(
  'convertsToBoolean',
  convertToBoolean,
);

/**
 * `toInteger()`: an Integer as it is, a string in the form `(\+|-)?\d+` within the 32-bit range
 * as its value, and true and false as `1` and `0`. A Decimal does not convert, so `1.0` and
 * `'1.0'` are empty, as is anything else.
 *
 * @see https://hl7.org/fhirpath/N1/#tointeger-integer
 */
export const toIntegerFunction: FunctionDefinition = conversionFunction(
  'toInteger',
  'Integer',
  convertToInteger,
);

/**
 * `convertsToInteger()`: whether `toInteger()` gives a value.
 *
 * @see https://hl7.org/fhirpath/N1/#convertstointeger-boolean
 */
export const convertsToIntegerFunction: FunctionDefinition = convertsToFunction(
  'convertsToInteger',
  convertToInteger,
);

/**
 * `toDecimal()`: an Integer or Decimal as a Decimal, a string in the form `(\+|-)?\d+(\.\d+)?`
 * with the precision it is written with (`'1.50'` is `1.50`), and true and false as `1.0` and
 * `0.0`. Anything else is empty, and so is a string beyond the Decimal size bound.
 *
 * @see https://hl7.org/fhirpath/N1/#todecimal-decimal
 */
export const toDecimalFunction: FunctionDefinition = conversionFunction(
  'toDecimal',
  'Decimal',
  convertToDecimal,
);

/**
 * `convertsToDecimal()`: whether `toDecimal()` gives a value.
 *
 * @see https://hl7.org/fhirpath/N1/#convertstodecimal-boolean
 */
export const convertsToDecimalFunction: FunctionDefinition = convertsToFunction(
  'convertsToDecimal',
  convertToDecimal,
);

/**
 * `toDate()`: a Date as it is, the date part of a DateTime as written (no timezone conversion),
 * and a string in the form `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, to its own precision. Anything else
 * is empty, including a string with a time.
 *
 * @see https://hl7.org/fhirpath/N1/#todate-date
 * @see https://hl7.org/fhirpath/STU3/en/index.html#todateformat--string--date
 */
export const toDateFunction: FunctionDefinition = conversionFunction(
  'toDate',
  'Date',
  convertToDate,
);

/**
 * `convertsToDate()`: whether `toDate()` gives a value.
 *
 * @see https://hl7.org/fhirpath/N1/#convertstodate-boolean
 */
export const convertsToDateFunction: FunctionDefinition = convertsToFunction(
  'convertsToDate',
  convertToDate,
);

/**
 * `toDateTime()`: a DateTime as it is, a Date as a DateTime with the same date and no time, and a
 * string in the form `YYYY-MM-DDThh:mm:ss.fff(+|-)hh:mm` to its own precision, from the year alone
 * to the milliseconds, with an optional offset (`Z` or `±hh:mm`). Anything else is empty.
 *
 * @see https://hl7.org/fhirpath/N1/#todatetime-datetime
 */
export const toDateTimeFunction: FunctionDefinition = conversionFunction(
  'toDateTime',
  'DateTime',
  convertToDateTime,
);

/**
 * `convertsToDateTime()`: whether `toDateTime()` gives a value.
 *
 * @see https://hl7.org/fhirpath/N1/#convertstodatetime-boolean
 */
export const convertsToDateTimeFunction: FunctionDefinition = convertsToFunction(
  'convertsToDateTime',
  convertToDateTime,
);

/**
 * `toTime()`: a Time as it is, and a string in the form `hh:mm:ss.fff` to its own precision.
 * A string with a timezone offset is empty, because Time values have none
 * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#string-forms-accepted-by-todatetime-and-totime)),
 * as is anything else.
 *
 * @see https://hl7.org/fhirpath/N1/#totime-time
 */
export const toTimeFunction: FunctionDefinition = conversionFunction(
  'toTime',
  'Time',
  convertToTime,
);

/**
 * `convertsToTime()`: whether `toTime()` gives a value.
 *
 * @see https://hl7.org/fhirpath/N1/#convertstotime-boolean
 */
export const convertsToTimeFunction: FunctionDefinition = convertsToFunction(
  'convertsToTime',
  convertToTime,
);

/**
 * `toString()`: the String form of a String, Boolean, Integer, Decimal, Date, DateTime, Time or
 * Quantity. A Decimal keeps its precision (`1.0` is `'1.0'`), dates and times have no `@` or
 * `T` prefix and only their own precision (`@2014-12` is `'2014-12'`), and a quantity writes a
 * UCUM unit quoted and a calendar keyword in the singular without quotes (`1 'wk'`, `1 week`).
 * Anything else, such as a resource, is empty.
 *
 * @see https://hl7.org/fhirpath/N1/#tostring-string
 * @see https://hl7.org/fhirpath/STU3/en/index.html#tostring--string
 */
export const toStringFunction: FunctionDefinition = conversionFunction(
  'toString',
  'String',
  convertToString,
);

/**
 * `convertsToString()`: whether `toString()` gives a value.
 *
 * @see https://hl7.org/fhirpath/N1/#convertstostring-string
 */
export const convertsToStringFunction: FunctionDefinition = convertsToFunction(
  'convertsToString',
  convertToString,
);

const UNIT_PARAMS: readonly ParamSpec[] = Object.freeze([
  { kind: 'value', name: 'unit', optional: true },
]);

/**
 * `toQuantity([unit])`: a Quantity as it is; an Integer or Decimal with the unit `'1'`; true and
 * false as `1.0 '1'` and `0.0 '1'`; and a string in the form
 * `(\+|-)?\d+(\.\d+)?\s*('unit'|keyword)?`, where the unit is a quoted UCUM unit or an unquoted
 * calendar keyword (`'4 days'`, `'10 \'mg[Hg]\''`), and no unit means `'1'`. An unquoted word that
 * is not a calendar keyword (`'1 wk'`) does not convert, and a quoted unit is not checked against
 * the unit system, as for quantity literals.
 *
 * With a unit, the quantity is converted to it by the unit system, as an explicit conversion
 * ([3.0.0 unit conversions](https://hl7.org/fhirpath/STU3/en/index.html#time-valued-unit-conversions)):
 * `1 'wk'.toQuantity('d')` is `7 'd'`, and `7 days.toQuantity('wk')` is `1 'wk'`. It is empty when
 * the units cannot be related. The unit must be a String; when it is empty, the quantity is not
 * converted.
 *
 * @see https://hl7.org/fhirpath/N1/#toquantityunit-string-quantity
 * @see https://hl7.org/fhirpath/STU3/en/index.html#toquantityunit--string--quantity
 */
export const toQuantityFunction: FunctionDefinition = conversionFunction(
  'toQuantity',
  'Quantity',
  convertToQuantity,
  UNIT_PARAMS,
);

/**
 * `convertsToQuantity([unit])`: whether `toQuantity([unit])` gives a value.
 *
 * @see https://hl7.org/fhirpath/N1/#convertstoquantityunit-string-boolean
 * @see https://hl7.org/fhirpath/STU3/en/index.html#convertstoquantityunit--string--boolean
 */
export const convertsToQuantityFunction: FunctionDefinition = convertsToFunction(
  'convertsToQuantity',
  convertToQuantity,
  UNIT_PARAMS,
);

/** The conversion functions of the standard library. */
export const CONVERSION_FUNCTIONS: readonly FunctionDefinition[] = Object.freeze([
  iifFunction,
  toBooleanFunction,
  convertsToBooleanFunction,
  toIntegerFunction,
  convertsToIntegerFunction,
  toDecimalFunction,
  convertsToDecimalFunction,
  toDateFunction,
  convertsToDateFunction,
  toDateTimeFunction,
  convertsToDateTimeFunction,
  toTimeFunction,
  convertsToTimeFunction,
  toStringFunction,
  convertsToStringFunction,
  toQuantityFunction,
  convertsToQuantityFunction,
]);

/** `toX()`: the converted single input item, or empty. */
function conversionFunction(
  name: string,
  type: Exclude<SystemTypeName, 'Any'>,
  convert: Conversion,
  params: readonly ParamSpec[] = [],
): FunctionDefinition {
  return defineValueFunction(
    name,
    params,
    (input, args, call) => {
      const value = singleValue(input);
      return value === undefined ? EMPTY : fromOptional(convert(value, args, call));
    },
    { returns: { type, singleton: true } },
  );
}

/** `convertsToX()`: whether the single input item converts; empty for empty input. */
function convertsToFunction(
  name: string,
  convert: Conversion,
  params: readonly ParamSpec[] = [],
): FunctionDefinition {
  return defineValueFunction(
    name,
    params,
    (input, args, call) => {
      const value = singleValue(input);
      return value === undefined ? EMPTY : fromBoolean(convert(value, args, call) !== undefined);
    },
    { returns: { type: 'Boolean', singleton: true } },
  );
}

/**
 * The System value of the single input item, or undefined for empty input and for a node that
 * holds no value.
 *
 * @throws {@link FhirPathEvaluationError} `eval/singleton-expected` for more than one item.
 */
function singleValue(input: Collection): Item | undefined {
  // `Any` passes a node without a value through, so this function decides that it is empty.
  const item = singleton(input, 'Any', identity);
  return item === undefined ? undefined : toSystemValue(item);
}

function identity(item: Item): Item {
  return item;
}

function convertToBoolean(value: Item): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value === 1 ? true : value === 0 ? false : undefined;
  }
  if (value instanceof Decimal) {
    // 3.0.0: "1.0 (or decimal equivalent)", so 1.00 and 0.000 convert as well.
    return value.compare(Decimal.ONE) === 0 ? true : value.sign() === 0 ? false : undefined;
  }
  if (typeof value === 'string') {
    // Locale-independent lower case. No other character folds into these ASCII words.
    return BOOLEAN_TEXT.get(value.toLowerCase());
  }
  return undefined;
}

function convertToInteger(value: Item): number | undefined {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'string') {
    return parseInteger(value);
  }
  // TODO(T0028): a Long in the Integer range converts (3.0.0).
  return undefined;
}

/**
 * The Integer that `text` denotes, or undefined when it is not in the Integer format or outside
 * the 32-bit range. `Number()` is exact here: below 2^53 every whole number is, and above it the
 * value is out of range anyway.
 */
function parseInteger(text: string): number | undefined {
  if (!INTEGER_TEXT.test(text)) {
    return undefined;
  }
  const value = Number(text);
  // `+ 0` turns the `-0` of `'-0'` into `0`.
  return value >= MIN_INTEGER && value <= MAX_INTEGER ? value + 0 : undefined;
}

function convertToDecimal(value: Item): Decimal | undefined {
  if (value instanceof Decimal) {
    return value;
  }
  if (typeof value === 'number') {
    return Decimal.fromInteger(value);
  }
  if (typeof value === 'boolean') {
    return value ? DECIMAL_TRUE : DECIMAL_FALSE;
  }
  if (typeof value === 'string') {
    return Decimal.parse(value);
  }
  // TODO(T0028): a Long converts (3.0.0).
  return undefined;
}

function convertToDate(value: Item): DateValue | undefined {
  if (value instanceof DateValue) {
    return value;
  }
  if (value instanceof DateTimeValue) {
    return value.toDateValue();
  }
  return typeof value === 'string' ? parseDate(value) : undefined;
}

function convertToDateTime(value: Item): DateTimeValue | undefined {
  if (value instanceof DateTimeValue) {
    return value;
  }
  if (value instanceof DateValue) {
    return DateTimeValue.fromDate(value);
  }
  return typeof value === 'string' ? parseDateTime(value) : undefined;
}

function convertToTime(value: Item): TimeValue | undefined {
  if (value instanceof TimeValue) {
    return value;
  }
  return typeof value === 'string' ? parseTime(value) : undefined;
}

function convertToString(value: Item): string | undefined {
  switch (typeof value) {
    case 'string':
      return value;
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return String(value);
    default:
      break;
  }
  if (
    value instanceof Decimal ||
    value instanceof DateValue ||
    value instanceof DateTimeValue ||
    value instanceof TimeValue ||
    value instanceof Quantity
  ) {
    return value.toString();
  }
  // TODO(T0028): a Long converts (3.0.0).
  return undefined;
}

function convertToQuantity(
  value: Item,
  args: readonly Collection[],
  call: CallContext,
): Quantity | undefined {
  const quantity = quantityOf(value);
  const unit = singleton(args[0] ?? EMPTY, 'String', asString);
  if (quantity === undefined || unit === undefined) {
    return quantity;
  }
  const converted = call.ctx.units.convert(quantity.value, quantity.unit, unit, {
    explicit: true,
  });
  return converted === undefined ? undefined : new Quantity(converted, unit);
}

/** A value as a Quantity, before any conversion to the unit argument. */
function quantityOf(value: Item): Quantity | undefined {
  if (typeof value === 'boolean') {
    return new Quantity(value ? DECIMAL_TRUE : DECIMAL_FALSE, '1');
  }
  if (typeof value === 'string') {
    return parseQuantity(value);
  }
  // A Quantity as it is, an Integer or Decimal with the unit '1'.
  // TODO(T0028): a Long converts (3.0.0).
  return asQuantity(value);
}

/** The Quantity that `text` denotes in the format of {@link QUANTITY_TEXT}, or undefined. */
function parseQuantity(text: string): Quantity | undefined {
  const match = QUANTITY_TEXT.exec(text);
  if (match === null) {
    return undefined;
  }
  const [, number = '', quoted, keyword] = match;
  if (keyword !== undefined && !isCalendarUnit(keyword)) {
    return undefined;
  }
  const value = Decimal.parse(number);
  return value === undefined ? undefined : new Quantity(value, quoted ?? keyword ?? '1');
}

/** The item as a String, for the unit argument, or undefined when it is not one. */
function asString(item: Item): string | undefined {
  const value = toSystemValue(item);
  return typeof value === 'string' ? value : undefined;
}
