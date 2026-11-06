/** Arithmetic dispatch over System values. @see https://hl7.org/fhirpath/N1/#math */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { addCalendar, subtractCalendar } from '../values/datetime/arithmetic.ts';
import type { Decimal } from '../values/decimal/decimal.ts';
import {
  addQuantity,
  divideQuantity,
  multiplyQuantity,
  subtractQuantity,
} from '../values/quantity/operations.ts';
import { Quantity } from '../values/quantity/quantity.ts';
import type { UnitSystem } from '../values/quantity/unit-system.ts';
import { type Collection, fromOptional, type Item } from './collection.ts';
import { toSystemValue } from './node-value.ts';
import { asQuantity, isNumber, isTemporal, toDecimal } from './operands.ts';
import { singleton } from './singleton.ts';

/** The binary math operators, including the two String concatenations. */
export type ArithmeticOperator = '+' | '-' | '*' | '/' | 'div' | 'mod' | '&';

/**
 * Applies a math operator after singleton evaluation. Overflow and division by zero give empty;
 * cardinality and incompatible types raise the two singleton error codes.
 * @see https://hl7.org/fhirpath/N1/#math
 * @see https://hl7.org/fhirpath/N1/#datetime-arithmetic
 */
export function arithmetic(
  op: ArithmeticOperator,
  left: Collection,
  right: Collection,
  units: UnitSystem,
): Collection {
  const a = systemSingleton(left);
  const b = systemSingleton(right);
  if (op === '&') {
    return [stringOperand(a) + stringOperand(b)];
  }
  if (a === undefined || b === undefined) return [];
  if (isNumber(a) && isNumber(b)) return fromOptional(numeric(op, a, b));
  if (op === '+' && typeof a === 'string' && typeof b === 'string') return [a + b];
  if ((op === '+' || op === '-') && isTemporal(a) && b instanceof Quantity) {
    return [op === '+' ? addCalendar(a, b.value, b.unit) : subtractCalendar(a, b.value, b.unit)];
  }
  if (a instanceof Quantity || b instanceof Quantity) {
    const quantityA = asQuantity(a);
    const quantityB = asQuantity(b);
    if (quantityA !== undefined && quantityB !== undefined) {
      switch (op) {
        case '+':
          return fromOptional(addQuantity(quantityA, quantityB, units));
        case '-':
          return fromOptional(subtractQuantity(quantityA, quantityB, units));
        case '*':
          return fromOptional(multiplyQuantity(quantityA, quantityB, units));
        case '/':
          return fromOptional(divideQuantity(quantityA, quantityB, units));
      }
    }
  }
  throw mismatch(op);
}

function identity(item: Item): Item {
  return item;
}

function systemSingleton(items: Collection): Item | undefined {
  const item = singleton(items, 'Any', identity);
  return item === undefined ? undefined : toSystemValue(item);
}

function stringOperand(value: Item | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  throw mismatch('&');
}

function numeric(
  op: Exclude<ArithmeticOperator, '&'>,
  a: number | Decimal,
  b: number | Decimal,
): number | Decimal | undefined {
  // Integer products outside the exact JS range are already outside the 32-bit result range.
  // https://hl7.org/fhirpath/STU3/en/index.html#math-1: overflow and underflow give empty.
  if (typeof a === 'number' && typeof b === 'number' && op !== '/') {
    let result: number;
    switch (op) {
      case '+':
        result = a + b;
        break;
      case '-':
        result = a - b;
        break;
      case '*':
        result = a * b;
        break;
      case 'div':
        result = Math.trunc(a / b);
        break;
      case 'mod':
        result = a % b;
        break;
    }
    return Number.isInteger(result) && result >= -2147483648 && result <= 2147483647
      ? result + 0
      : undefined;
  }
  const left = toDecimal(a);
  const right = toDecimal(b);
  switch (op) {
    case '+':
      return left.add(right);
    case '-':
      return left.subtract(right);
    case '*':
      return left.multiply(right);
    case '/':
      return left.divide(right);
    case 'div':
      return left.div(right);
    case 'mod':
      return left.mod(right);
  }
}

function mismatch(op: ArithmeticOperator): FhirPathEvaluationError {
  return new FhirPathEvaluationError('eval/type-mismatch', `Incompatible operands for ${op}`);
}
