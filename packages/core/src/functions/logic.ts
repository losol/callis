/**
 * `not()`, the function of the Boolean logic section
 * ([N1 §6.5](https://hl7.org/fhirpath/N1/#boolean-logic)); `and`, `or`, `xor` and `implies` are
 * operators and live in the compiler.
 */
import { fromBoolean } from '../runtime/collection.ts';
import { asBoolean } from '../runtime/item-conversion.ts';
import { not } from '../runtime/logic.ts';
import { singleton } from '../runtime/singleton.ts';
import { defineValueFunction, type FunctionDefinition } from './define.ts';

/**
 * `not()`: true for false, false for true, empty for empty. The input is a Boolean by singleton
 * evaluation, so any other single item counts as true and `'a'.not()` is false.
 *
 * @see https://hl7.org/fhirpath/N1/#not-boolean
 */
export const notFunction: FunctionDefinition = defineValueFunction(
  'not',
  0,
  (input) => fromBoolean(not(singleton(input, 'Boolean', asBoolean))),
  { returns: { type: 'Boolean', singleton: true } },
);

/** The Boolean logic functions of the standard library. */
export const LOGIC_FUNCTIONS: readonly FunctionDefinition[] = Object.freeze([notFunction]);
