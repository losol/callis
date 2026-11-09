/**
 * The combining functions `union()` and `combine()`
 * ([N1 §5.4](https://hl7.org/fhirpath/N1/#combining)). The subsetting functions are in
 * `subsetting.ts`.
 */
import { concat, EMPTY } from '../runtime/collection.ts';
import { BINARY_OPERATIONS } from '../runtime/operators.ts';
import { defineValueFunction, type FunctionDefinition, type ParamSpec } from './define.ts';

const OTHER: readonly ParamSpec[] = Object.freeze([{ kind: 'value', name: 'other' }]);

/**
 * `union(other)`: the items of the input and of `other` without duplicates, by `=`: the input
 * items first, then the new items of `other`, each at its first position. It is the `|` operator,
 * which the spec calls synonymous, and shares its rules for undetermined equality and for the
 * items it keeps.
 * @see https://hl7.org/fhirpath/N1/#unionother-collection
 */
export const unionFunction: FunctionDefinition = defineValueFunction(
  'union',
  OTHER,
  (input, args, call) => BINARY_OPERATIONS['|'](input, args[0] ?? EMPTY, call.ctx),
);

/**
 * `combine(other)`: the items of the input followed by those of `other`, keeping duplicates. The
 * spec leaves the order open; this keeps it, so the result is the same on every evaluation.
 * @see https://hl7.org/fhirpath/N1/#combineother-collection-collection
 */
export const combineFunction: FunctionDefinition = defineValueFunction(
  'combine',
  OTHER,
  (input, args) => concat(input, args[0] ?? EMPTY),
);

/** The implemented combining functions of the standard library. */
export const COMBINING_FUNCTIONS: readonly FunctionDefinition[] = Object.freeze([
  unionFunction,
  combineFunction,
]);
