import { evaluate, FhirPathError } from '@callis/core';
import { type ExpectedOutcome, exampleOptions } from '../../../../../examples/playground/schema';

/** A run's display data; JSON errors never claim an invented expression location. */
export type Outcome =
  | { kind: 'result'; value: unknown[]; text: string; count: number }
  | {
      kind: 'error';
      phase: 'json' | 'expression';
      area: 'Invalid JSON' | 'Expression error';
      text: string;
      code?: string;
    };

/** Parse input locally and evaluate through the public API with exact computed decimals. */
export function runPlayground(json: string, expression: string): Outcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return {
      kind: 'error',
      phase: 'json',
      area: 'Invalid JSON',
      text: error instanceof Error ? error.message : 'Enter valid JSON.',
    };
  }
  try {
    const result = evaluate(parsed, expression, exampleOptions);
    return {
      kind: 'result',
      value: result,
      text: JSON.stringify(result, null, 2),
      count: result.length,
    };
  } catch (error) {
    return {
      kind: 'error',
      phase: 'expression',
      area: 'Expression error',
      ...(error instanceof FhirPathError ? { code: error.code } : {}),
      text:
        error instanceof FhirPathError ? error.format() : 'The expression could not be evaluated.',
    };
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]))
    );
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null)
    return false;
  const entries = Object.entries(left);
  return (
    entries.length === Object.keys(right).length &&
    entries.every(
      ([key, value]) =>
        Object.hasOwn(right, key) &&
        sameValue(value, Object.getOwnPropertyDescriptor(right, key)?.value),
    )
  );
}

/** Compare plain values or phase/code, independently of formatting and object key order. */
export function matchesExpected(actual: Outcome, expected: ExpectedOutcome): boolean {
  if (actual.kind === 'result' && expected.kind === 'result')
    return sameValue(actual.value, expected.value);
  if (actual.kind !== 'error' || expected.kind !== 'error' || actual.phase !== expected.phase)
    return false;
  return expected.phase === 'json' || actual.code === expected.code;
}
