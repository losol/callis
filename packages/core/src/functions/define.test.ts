import { describe, expect, it } from 'vitest';
import type { Collection } from '../runtime/collection.ts';
import {
  type Arg,
  arityOf,
  defineFunction,
  defineValueFunction,
  type FunctionDefinition,
  type LambdaArg,
  lambdaArg,
  type ParamSpec,
  paramAt,
  typeArg,
  valueArg,
} from './define.ts';

// https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#function-library
function definition(params: readonly ParamSpec[]): FunctionDefinition {
  return { name: 'f', params, impl: (_call, input) => input };
}

const lambda: LambdaArg = {
  kind: 'lambda',
  forItem: () => [],
  forInput: () => [],
  inPlace: () => [],
};
const type: Arg = { kind: 'type', target: { kind: 'resource', name: 'Patient' } };

describe('arityOf and paramAt', () => {
  it.each<[string, readonly ParamSpec[], number, number]>([
    ['no parameters', [], 0, 0],
    ['two required', [{ kind: 'value' }, { kind: 'value' }], 2, 2],
    ['an optional one', [{ kind: 'value' }, { kind: 'lambda', optional: true }], 1, 2],
    ['a variadic one', [{ kind: 'value' }, { kind: 'value', variadic: true }], 1, Infinity],
  ])('counts %s', (_label, params, min, max) => {
    expect(arityOf(definition(params))).toEqual({ min, max });
  });

  it('gives the variadic parameter for every argument past the last one', () => {
    const variadic: ParamSpec = { kind: 'value', variadic: true };
    const fn = definition([{ kind: 'lambda' }, variadic]);
    expect(paramAt(fn, 0)?.kind).toBe('lambda');
    expect(paramAt(fn, 1)).toEqual(variadic);
    expect(paramAt(fn, 5)).toEqual(variadic);
    expect(paramAt(definition([{ kind: 'value' }]), 1)).toBeUndefined();
  });
});

describe('defineFunction', () => {
  it('returns a frozen copy', () => {
    const params: ParamSpec[] = [{ kind: 'value' }];
    const defined = defineFunction(definition(params));
    expect(Object.isFrozen(defined)).toBe(true);
    expect(Object.isFrozen(defined.params)).toBe(true);
    params.push({ kind: 'value' });
    expect(defined.params).toHaveLength(1);
  });

  it.each<[string, FunctionDefinition]>([
    ['an empty name', { name: '', params: [], impl: (_c, input) => input }],
    ['an unknown parameter kind', definition([{ kind: 'other' as never }])],
    [
      'a required parameter after an optional one',
      definition([{ kind: 'value', optional: true }, { kind: 'value' }]),
    ],
    [
      'a variadic parameter that is not last',
      definition([{ kind: 'value', variadic: true }, { kind: 'value' }]),
    ],
    ['no implementation', { name: 'f', params: [], impl: undefined as never }],
  ])('raises eval/invalid-argument for %s', (_label, invalid) => {
    expect(() => defineFunction(invalid)).toThrow(
      expect.objectContaining({ code: 'eval/invalid-argument' }),
    );
  });
});

describe('argument accessors', () => {
  const args: readonly Arg[] = [['a'], lambda, type];

  it('give each kind of argument', () => {
    expect(valueArg(args, 0)).toEqual(['a']);
    expect(lambdaArg(args, 1)).toBe(lambda);
    expect(typeArg(args, 2)).toEqual({ kind: 'resource', name: 'Patient' });
  });

  it('give empty or undefined for an argument that was left out', () => {
    expect(valueArg(args, 3)).toEqual([]);
    expect(lambdaArg(args, 3)).toBeUndefined();
  });

  it.each<[string, () => unknown]>([
    ['a lambda read as a value', () => valueArg(args, 1)],
    ['a value read as a lambda', () => lambdaArg(args, 0)],
    ['a type read as a lambda', () => lambdaArg(args, 2)],
    ['a value read as a type', () => typeArg(args, 0)],
    ['a missing type', () => typeArg(args, 3)],
  ])('raise eval/invalid-argument for %s', (_label, read) => {
    expect(read).toThrow(expect.objectContaining({ code: 'eval/invalid-argument' }));
  });
});

describe('defineValueFunction', () => {
  it('passes the arguments as collections', () => {
    let received: readonly Collection[] = [];
    const fn = defineValueFunction('f', 2, (input, values) => {
      received = values;
      return input;
    });
    expect(fn.params).toEqual([{ kind: 'value' }, { kind: 'value' }]);
    const call = {
      ctx: undefined as never,
      frame: undefined as never,
      name: 'f',
      span: undefined as never,
    };
    expect(fn.impl(call, [1], [['a'], ['b']])).toEqual([1]);
    expect(received).toEqual([['a'], ['b']]);
  });
});
