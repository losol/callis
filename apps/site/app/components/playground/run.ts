import { evaluate, FhirPathError } from '@callis/core';

/** A run's display data; JSON errors never claim an invented expression location. */
export type Outcome =
  | { kind: 'result'; text: string; count: number }
  | { kind: 'error'; area: 'Invalid JSON' | 'Expression error'; text: string };

/** Parse input locally and evaluate through the public API with exact computed decimals. */
export function runPlayground(json: string, expression: string): Outcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return {
      kind: 'error',
      area: 'Invalid JSON',
      text: error instanceof Error ? error.message : 'Enter valid JSON.',
    };
  }
  try {
    const result = evaluate(parsed, expression, { decimalOutput: 'string' });
    return { kind: 'result', text: JSON.stringify(result, null, 2), count: result.length };
  } catch (error) {
    return {
      kind: 'error',
      area: 'Expression error',
      text:
        error instanceof FhirPathError ? error.format() : 'The expression could not be evaluated.',
    };
  }
}
