import { FhirPathEvaluationError } from './fhirpath-error.ts';

/**
 * Ends a `switch` over a discriminated union: TypeScript reports a missing case as a compile
 * error, because only `never` is accepted here.
 *
 * It can still run when JavaScript code passes a value the types do not allow, such as a
 * hand-made AST node with an unknown kind; that is an invalid argument.
 *
 * @throws {@link FhirPathEvaluationError} `eval/invalid-argument`, always.
 */
export function assertNever(value: never, what: string): never {
  throw new FhirPathEvaluationError(
    'eval/invalid-argument',
    `Unexpected ${what}: ${JSON.stringify(value) ?? String(value)}`,
  );
}
