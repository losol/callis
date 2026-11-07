import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import { fromOptional } from '../runtime/collection.ts';
import { defineValueFunction, type FunctionDefinition } from './define.ts';

/**
 * `first()`: the first input item, unchanged, or empty when there is none.
 * @see https://hl7.org/fhirpath/N1/#first-collection
 */
export const firstFunction: FunctionDefinition = defineValueFunction(
  'first',
  0,
  (input) => fromOptional(input[0]),
  { returns: { singleton: true } },
);

/**
 * `single()`: the input unchanged when empty or singleton; errors on multiple items.
 * @see https://hl7.org/fhirpath/N1/#single-collection
 */
export const singleFunction: FunctionDefinition = defineValueFunction(
  'single',
  0,
  (input) => {
    if (input.length > 1) {
      throw new FhirPathEvaluationError(
        'eval/singleton-expected',
        `Expected a single item but found ${input.length} items`,
      );
    }
    return input;
  },
  { returns: { singleton: true } },
);

/** The implemented subsetting functions of the standard library. */
export const SUBSETTING_FUNCTIONS: readonly FunctionDefinition[] = Object.freeze([
  firstFunction,
  singleFunction,
]);
