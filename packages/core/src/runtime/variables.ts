/**
 * Environment variables: `%context`, `%ucum`, the variables of the evaluation's environment and the
 * variables the host supplies ([N1 §9](https://hl7.org/fhirpath/N1/#environment-variables)). The
 * environment defines the FHIR variables (`%resource`, `%rootResource`, `%sct`, `%loinc`,
 * `` %`vs-*` ``, `` %`ext-*` ``); `fhir/variables.ts` implements them.
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import type { ModelProvider } from '../model/model-provider.ts';
import type { Collection } from './collection.ts';
import type { EvalContext } from './context.ts';
import { toInputCollection } from './navigation.ts';

/** The value of `%ucum` ([N1 §9](https://hl7.org/fhirpath/N1/#environment-variables)). */
export const UCUM_URL = 'http://unitsofmeasure.org';

const UCUM: Collection = Object.freeze([UCUM_URL]);

/**
 * Converts the `variables` option into collections, keyed by name without the `%`.
 *
 * Each value goes through the same conversion as the input: JSON values become input nodes, typed
 * by the model when it recognizes them, an array gives one item per element, and `undefined`,
 * `null` and `[]` are a defined but empty variable
 * ([N1 §9](https://hl7.org/fhirpath/N1/#environment-variables)). Only own properties count, and
 * the result has no prototype.
 *
 * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` if `values` is not an object or
 *   a value is not JSON data.
 */
export function createVariables(
  values: unknown,
  model: ModelProvider | undefined = undefined,
): Readonly<Record<string, Collection>> {
  const variables: Record<string, Collection> = Object.create(null);
  if (values === undefined) {
    return variables;
  }
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    throw new FhirPathEvaluationError(
      'eval/invalid-argument',
      'Expected the variables option to be an object of variable values',
    );
  }
  for (const name of Object.keys(values)) {
    variables[name] = toInputCollection(
      (values as Readonly<Record<string, unknown>>)[name],
      name,
      model,
    );
  }
  return variables;
}

/**
 * The value of the variable `%name` in an evaluation, or undefined when it is not defined.
 * `%context` and `%ucum` are built in and cannot be redefined by the host. The host's variables
 * come next, so a host can still define a name that the environment (`ctx.environment`, such as
 * `%resource`) also defines, as it could before the environment had it.
 */
export function lookUpVariable(ctx: EvalContext, name: string): Collection | undefined {
  if (name === 'context') {
    return ctx.context;
  }
  if (name === 'ucum') {
    return UCUM;
  }
  return Object.hasOwn(ctx.variables, name) ? ctx.variables[name] : ctx.environment(name);
}
