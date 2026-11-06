import { describe, expect, it } from 'vitest';
import { ModelNode } from '../model/model-node.ts';
import { minimalUnitSystem } from '../values/quantity/unit-system.ts';
import type { EvalContext } from './context.ts';
import { createVariables, lookUpVariable, UCUM_URL } from './variables.ts';

function context(variables: unknown): EvalContext {
  return {
    isAsync: false,
    context: ['input'],
    variables: createVariables(variables),
    model: undefined,
    units: minimalUnitSystem,
    timezoneOffset: 0,
    now: () => {
      throw new Error('not used');
    },
  };
}

// https://hl7.org/fhirpath/N1/#environment-variables
describe('createVariables', () => {
  it('converts each value like the input', () => {
    const variables = createVariables({ text: 'a', list: [1, null, 2], none: null });
    const [text] = variables.text ?? [];
    expect(text).toBeInstanceOf(ModelNode);
    expect((text as ModelNode).name).toBe('text');
    expect(variables.list).toHaveLength(2);
    expect(variables.none).toEqual([]);
  });

  it('has no prototype, so prototype members are not variables', () => {
    const variables = createVariables({});
    expect(Object.getPrototypeOf(variables)).toBeNull();
    expect(Object.hasOwn(variables, 'constructor')).toBe(false);
  });

  it('reads own properties only', () => {
    const variables = createVariables(Object.create({ inherited: 1 }));
    expect(Object.hasOwn(variables, 'inherited')).toBe(false);
  });

  it.each([null, 'x', 1, [1]])('raises eval/invalid-argument for %j', (value) => {
    expect(() => createVariables(value)).toThrow(
      expect.objectContaining({ code: 'eval/invalid-argument' }),
    );
  });
});

describe('lookUpVariable', () => {
  it('gives %context and %ucum', () => {
    const ctx = context({});
    expect(lookUpVariable(ctx, 'context')).toEqual(['input']);
    expect(lookUpVariable(ctx, 'ucum')).toEqual([UCUM_URL]);
  });

  it('gives user variables, and lets defined empty variables be empty', () => {
    const ctx = context({ empty: [], value: true });
    expect(lookUpVariable(ctx, 'empty')).toEqual([]);
    expect(lookUpVariable(ctx, 'value')).toHaveLength(1);
  });

  it('gives undefined for a variable that is not defined', () => {
    const ctx = context({});
    for (const name of ['missing', 'constructor', '__proto__', 'toString']) {
      expect(lookUpVariable(ctx, name)).toBeUndefined();
    }
  });

  it('keeps %context and %ucum built in', () => {
    const ctx = context({ context: 'other', ucum: 'other' });
    expect(lookUpVariable(ctx, 'context')).toEqual(['input']);
    expect(lookUpVariable(ctx, 'ucum')).toEqual([UCUM_URL]);
  });
});
