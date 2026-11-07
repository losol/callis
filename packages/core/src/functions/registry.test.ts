import { describe, expect, it } from 'vitest';
import { FhirPathSemanticError } from '../errors/fhirpath-error.ts';
import { defineValueFunction, type FunctionDefinition } from './define.ts';
import { createRegistry } from './registry.ts';

// https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#function-library
const custom: FunctionDefinition = defineValueFunction('custom', 1, (input) => input);

function caught(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('createRegistry', () => {
  it('has the standard library by default', () => {
    expect(createRegistry().names()).toEqual(
      expect.arrayContaining(['as', 'is', 'not', 'where', 'exists', 'count']),
    );
  });

  it('can leave the standard library out', () => {
    expect(createRegistry({ standard: false, fhir: false }).names()).toEqual([]);
  });
});

describe('FunctionRegistry', () => {
  const registry = createRegistry();

  it('looks names up case-sensitively', () => {
    expect(registry.get('not')?.name).toBe('not');
    expect(registry.get('Not')).toBeUndefined();
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'does not find the prototype member %s',
    (name) => {
      expect(registry.get(name)).toBeUndefined();
    },
  );

  it('resolves a call with the right number of arguments', () => {
    expect(registry.resolve('not', 0).name).toBe('not');
  });

  it('raises semantic/unknown-function with the span and expression it is given', () => {
    const span = { start: 0, end: 5, line: 1, column: 1 };
    const error = caught(() => registry.resolve('nope', 0, { span, expression: 'nope()' }));
    expect(error).toBeInstanceOf(FhirPathSemanticError);
    expect(error).toMatchObject({ code: 'semantic/unknown-function', span, expression: 'nope()' });
  });

  it.each([1, 2])('raises semantic/wrong-arity for not() with %i arguments', (arity) => {
    expect(caught(() => registry.resolve('not', arity))).toMatchObject({
      code: 'semantic/wrong-arity',
    });
  });

  it('extends into a new registry and leaves the original unchanged', () => {
    const extended = registry.extend([custom]);
    expect(extended.get('custom')).toBeDefined();
    expect(registry.get('custom')).toBeUndefined();
    expect(extended.get('not')).toBe(registry.get('not'));
  });

  it('lets a definition replace one of the same name', () => {
    const replacement = defineValueFunction('not', 0, () => []);
    expect(registry.extend([replacement]).get('not')).toEqual(replacement);
  });

  it('checks definitions when it is extended', () => {
    const invalid = { name: '', params: [], impl: () => [] };
    expect(() => registry.extend([invalid])).toThrow(
      expect.objectContaining({ code: 'eval/invalid-argument' }),
    );
  });
});
