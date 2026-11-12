/**
 * The math functions of the standard library
 * ([N1 §5.7](https://hl7.org/fhirpath/N1/#math), STU in N1 but in phase-1 scope).
 *
 * The numbers come from the T0004 kernels, `Decimal` and `values/decimal/math.ts`. These functions
 * add what the kernels leave to the caller:
 *
 * - singleton evaluation of the input and the arguments
 *   ([N1 §4.5](https://hl7.org/fhirpath/N1/#singleton-evaluation-of-collections)): an empty
 *   collection gives an empty result, more than one item raises `eval/singleton-expected`, and an
 *   item that is not a number raises `eval/type-mismatch`
 * - the implicit Integer → Decimal conversion ([N1 §5.5](https://hl7.org/fhirpath/N1/#conversion))
 * - the 32-bit Integer range: an Integer result outside it is overflow, which is empty
 *   ([3.0.0 §6.6](https://hl7.org/fhirpath/STU3/#math-1))
 *
 * The result types follow FHIRPath 3.0.0 where it clarifies N1 (`docs/spec-notes.md`, "Math
 * functions"), and so does the Quantity input of `ceiling()`, `floor()`, `round()` and
 * `truncate()`, which N1 allows only for `abs()`.
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { type Collection, EMPTY, fromOptional, type Item } from '../runtime/collection.ts';
import { asInteger } from '../runtime/item-conversion.ts';
import { toSystemValue } from '../runtime/node-value.ts';
import { isNumber, toDecimal } from '../runtime/operands.ts';
import { singleton } from '../runtime/singleton.ts';
import type { Decimal } from '../values/decimal/decimal.ts';
import { exp, ln, log, power, sqrt } from '../values/decimal/math.ts';
import { Quantity } from '../values/quantity/quantity.ts';
import { defineValueFunction, type FunctionDefinition, type TypeExpectation } from './define.ts';

/** The largest Integer, 2³¹ − 1 ([N1 §4.1.3](https://hl7.org/fhirpath/N1/#integer)). */
const INTEGER_MAX = 2147483647;

/** An Integer or a Decimal: what the numeric functions accept. */
type Numeric = number | Decimal;

/** The item as an Integer or a Decimal, or undefined when it is neither. */
function asNumeric(item: Item): Numeric | undefined {
  const value = toSystemValue(item);
  return value !== undefined && isNumber(value) ? value : undefined;
}

/** The item as an Integer, a Decimal or a Quantity, or undefined when it is none of them. */
function asNumericOrQuantity(item: Item): Numeric | Quantity | undefined {
  const value = toSystemValue(item);
  return value instanceof Quantity ? value : asNumeric(item);
}

/** The input and the arguments of the math functions: one Integer or Decimal. */
const NUMBER: TypeExpectation = { type: 'Decimal', singleton: true };
/** One number, or a Quantity, which keeps its unit. */
const NUMBER_OR_QUANTITY: TypeExpectation = { type: ['Decimal', 'Quantity'], singleton: true };

/** The single numeric input, or undefined when it is empty. */
function numericInput(input: Collection): Numeric | undefined {
  return singleton(input, 'Decimal', asNumeric);
}

/**
 * Defines a function from a Decimal to a Decimal. An Integer input converts to a Decimal first, and
 * the kernel gives `undefined` (empty) for a result that cannot be represented.
 */
function defineDecimalFunction(
  name: string,
  kernel: (value: Decimal) => Decimal | undefined,
): FunctionDefinition {
  return defineValueFunction(
    name,
    0,
    (input) => {
      const value = numericInput(input);
      return value === undefined ? EMPTY : fromOptional(kernel(toDecimal(value)));
    },
    { input: NUMBER, returns: { type: 'Decimal', singleton: true } },
  );
}

/**
 * Defines a function from a number or a Quantity to a whole number: an Integer input is returned as
 * it is, and a Decimal input gives the whole number that `kernel` picks as an Integer, which is
 * empty when it is outside the Integer range. A Quantity keeps its unit and gets that whole number
 * as its Decimal value, without the Integer range
 * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#ceiling-floor-round-and-truncate-of-a-quantity)).
 */
function defineWholeNumberFunction(
  name: string,
  kernel: (value: Decimal) => Decimal,
): FunctionDefinition {
  return defineValueFunction(
    name,
    0,
    (input) => {
      const value = singleton(input, 'Decimal', asNumericOrQuantity);
      if (value === undefined) {
        return EMPTY;
      }
      if (value instanceof Quantity) {
        return [new Quantity(kernel(value.value), value.unit)];
      }
      return typeof value === 'number' ? [value] : fromOptional(kernel(value).toInteger());
    },
    // An Integer or a Quantity, so the type is not fixed.
    { input: NUMBER_OR_QUANTITY, returns: { singleton: true } },
  );
}

/**
 * `abs()`: the absolute value, of the same type as the input. A Quantity keeps its unit.
 * `(-2147483648).abs()` is empty, because 2147483648 is not an Integer.
 * @see https://hl7.org/fhirpath/N1/#abs-integer-decimal-quantity
 */
export const absFunction: FunctionDefinition = defineValueFunction(
  'abs',
  0,
  (input) => {
    const value = singleton(input, 'Decimal', asNumericOrQuantity);
    if (value === undefined) {
      return EMPTY;
    }
    if (typeof value === 'number') {
      const magnitude = Math.abs(value);
      return magnitude <= INTEGER_MAX ? [magnitude] : EMPTY;
    }
    return [value instanceof Quantity ? new Quantity(value.value.abs(), value.unit) : value.abs()];
  },
  { input: NUMBER_OR_QUANTITY, returns: { fromInput: 'value', singleton: true } },
);

/**
 * `ceiling()`: the first Integer greater than or equal to the input. A Quantity keeps its unit:
 * `(5.5 'mg').ceiling()` is `6 'mg'`.
 * @see https://hl7.org/fhirpath/N1/#ceiling-integer
 * @see https://hl7.org/fhirpath/STU3/#ceiling--integer--quantity
 */
export const ceilingFunction: FunctionDefinition = defineWholeNumberFunction('ceiling', (value) =>
  value.ceiling(),
);

/**
 * `exp()`: e raised to the input, as a Decimal with at most 15 significant digits.
 * @see https://hl7.org/fhirpath/N1/#exp-decimal
 */
export const expFunction: FunctionDefinition = defineDecimalFunction('exp', exp);

/**
 * `floor()`: the first Integer less than or equal to the input. A Quantity keeps its unit:
 * `(-5.5 'mg').floor()` is `-6 'mg'`.
 * @see https://hl7.org/fhirpath/N1/#floor-integer
 * @see https://hl7.org/fhirpath/STU3/#floor--integer--quantity
 */
export const floorFunction: FunctionDefinition = defineWholeNumberFunction('floor', (value) =>
  value.floor(),
);

/**
 * `ln()`: the natural logarithm. Empty for zero and negative input.
 * @see https://hl7.org/fhirpath/N1/#ln-decimal
 */
export const lnFunction: FunctionDefinition = defineDecimalFunction('ln', ln);

/**
 * `log(base)`: the logarithm of the input to the given base. Empty when the input or the base is
 * empty; an input or a base of zero or less raises `eval/invalid-argument`, as FHIRPath 3.0.0
 * asks.
 * @see https://hl7.org/fhirpath/N1/#logbase-decimal-decimal
 * @see https://hl7.org/fhirpath/STU3/#logbase--decimal--decimal
 */
export const logFunction: FunctionDefinition = defineValueFunction(
  'log',
  [{ kind: 'value', name: 'base', expects: NUMBER }],
  (input, args) => {
    const value = numericInput(input);
    const base = numericInput(args[0] ?? EMPTY);
    if (value === undefined || base === undefined) {
      return EMPTY;
    }
    const number = toDecimal(value);
    const logBase = toDecimal(base);
    if (number.sign() <= 0) {
      throw invalidArgument('The input of log() must be greater than zero');
    }
    if (logBase.sign() <= 0) {
      throw invalidArgument('The base of log() must be greater than zero');
    }
    return fromOptional(log(number, logBase));
  },
  { input: NUMBER, returns: { type: 'Decimal', singleton: true } },
);

/**
 * `power(exponent)`: the input raised to the exponent, always a Decimal. Empty when the input or
 * the exponent is empty, and when the power cannot be represented: `(-1).power(0.5)`.
 * @see https://hl7.org/fhirpath/N1/#powerexponent-integer-decimal-integer-decimal
 * @see https://hl7.org/fhirpath/STU3/#powerexponent--integer--decimal--decimal
 */
export const powerFunction: FunctionDefinition = defineValueFunction(
  'power',
  [{ kind: 'value', name: 'exponent', expects: NUMBER }],
  (input, args) => {
    const value = numericInput(input);
    const exponent = numericInput(args[0] ?? EMPTY);
    if (value === undefined || exponent === undefined) {
      return EMPTY;
    }
    return fromOptional(power(toDecimal(value), toDecimal(exponent)));
  },
  { input: NUMBER, returns: { type: 'Decimal', singleton: true } },
);

/**
 * `round([precision])`: rounds half away from zero to `precision` digits after the decimal point,
 * 0 by default. The result is a Decimal, also for an Integer input, and a Quantity keeps its unit:
 * `(5.55 'mg').round(1)` is `5.6 'mg'`. A precision below zero raises `eval/invalid-argument`, also
 * when the input is empty; an empty precision gives an empty result.
 * @see https://hl7.org/fhirpath/N1/#roundprecision-integer-decimal
 * @see https://hl7.org/fhirpath/STU3/#roundprecision--integer--decimal--quantity
 */
export const roundFunction: FunctionDefinition = defineValueFunction(
  'round',
  [
    {
      kind: 'value',
      name: 'precision',
      optional: true,
      expects: { type: 'Integer', singleton: true },
    },
  ],
  (input, args) => {
    const value = singleton(input, 'Decimal', asNumericOrQuantity);
    const precisionArg = args[0];
    const precision =
      precisionArg === undefined ? 0 : singleton(precisionArg, 'Integer', asInteger);
    if (precision !== undefined && precision < 0) {
      throw invalidArgument('The precision of round() must be zero or more');
    }
    if (value === undefined || precision === undefined) {
      return EMPTY;
    }
    if (value instanceof Quantity) {
      return [new Quantity(value.value.round(precision), value.unit)];
    }
    return [toDecimal(value).round(precision)];
  },
  // A Decimal or a Quantity, so the type is not fixed.
  { input: NUMBER_OR_QUANTITY, returns: { singleton: true } },
);

/**
 * `sqrt()`: the square root as a Decimal. Empty for negative input: `(-1).sqrt()`.
 * @see https://hl7.org/fhirpath/N1/#sqrt-decimal
 */
export const sqrtFunction: FunctionDefinition = defineDecimalFunction('sqrt', sqrt);

/**
 * `truncate()`: the integer part of the input, towards zero. A Quantity keeps its unit:
 * `(-5.5 'mg').truncate()` is `-5 'mg'`.
 * @see https://hl7.org/fhirpath/N1/#truncate-integer
 * @see https://hl7.org/fhirpath/STU3/#truncate--integer--quantity
 */
export const truncateFunction: FunctionDefinition = defineWholeNumberFunction('truncate', (value) =>
  value.truncate(),
);

/** The implemented math functions of the standard library. */
export const MATH_FUNCTIONS: readonly FunctionDefinition[] = Object.freeze([
  absFunction,
  ceilingFunction,
  expFunction,
  floorFunction,
  lnFunction,
  logFunction,
  powerFunction,
  roundFunction,
  sqrtFunction,
  truncateFunction,
]);

function invalidArgument(message: string): FhirPathEvaluationError {
  return new FhirPathEvaluationError('eval/invalid-argument', message);
}
