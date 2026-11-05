import type { BinaryOperator } from './ast.ts';

/** Infix binding power; every operator is left-associative (N1 §6.8).
 * @see https://hl7.org/fhirpath/N1/#operator-precedence
 */
export const INFIX_BINDING_POWER: Readonly<Record<BinaryOperator | 'is' | 'as', number>> = {
  '*': 10,
  '/': 10,
  div: 10,
  mod: 10,
  '+': 9,
  '-': 9,
  '&': 9,
  is: 8,
  as: 8,
  '|': 7,
  '<': 6,
  '>': 6,
  '<=': 6,
  '>=': 6,
  '=': 5,
  '~': 5,
  '!=': 5,
  '!~': 5,
  in: 4,
  contains: 4,
  and: 3,
  or: 2,
  xor: 2,
  implies: 1,
};

/** Invocation binds tighter than indexing, which binds tighter than prefix polarity. */
export const POSTFIX_BINDING_POWER: Readonly<{ member: number; indexer: number; unary: number }> = {
  member: 13,
  indexer: 12,
  unary: 11,
};

/** Guards table lookups against prototype keys such as constructor. */
export function isInfixOperator(value: string): value is BinaryOperator | 'is' | 'as' {
  return Object.hasOwn(INFIX_BINDING_POWER, value);
}
