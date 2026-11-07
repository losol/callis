import { EMPTY } from '../runtime/collection.ts';
import { andThen, mapSequential } from '../runtime/maybe-promise.ts';
import { matchesCriteria } from './criteria.ts';
import { defineFunction, type FunctionDefinition, lambdaArg } from './define.ts';

/**
 * `where(criteria)`: retains matching input items in order, with their original provenance.
 * Empty input does not evaluate the criterion. Each item has its own bound `$this` and `$index`.
 * @see https://hl7.org/fhirpath/N1/#wherecriteria-expression-collection
 */
export const whereFunction: FunctionDefinition = defineFunction({
  name: 'where',
  params: [{ kind: 'lambda', name: 'criteria' }],
  impl: (_call, input, args) => {
    const criteria = lambdaArg(args, 0);
    if (criteria === undefined) return EMPTY;
    return andThen(
      mapSequential(input, (item, index) => matchesCriteria(criteria, item, index)),
      (matches) => input.filter((_item, index) => matches[index] === true),
    );
  },
});

/** The implemented filtering functions of the standard library. */
export const FILTERING_FUNCTIONS: readonly FunctionDefinition[] = Object.freeze([whereFunction]);
