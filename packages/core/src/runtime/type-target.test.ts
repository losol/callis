import { describe, expect, it } from 'vitest';
import { stubModel, stubType } from '../../test/support/stub-model.ts';
import { ModelNode } from '../model/model-node.ts';
import { SYSTEM_TYPES } from '../types/system-types.ts';
import { DateValue } from '../values/datetime/date.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { Quantity } from '../values/quantity/quantity.ts';
import { minimalUnitSystem } from '../values/quantity/unit-system.ts';
import type { Item } from './collection.ts';
import type { EvalContext } from './context.ts';
import { toInputCollection } from './navigation.ts';
import {
  asType,
  isType,
  matchesTypeTarget,
  resolveTypeTarget,
  systemTypeOf,
  type TypeTarget,
} from './type-target.ts';

function context(model: EvalContext['model'] = undefined): EvalContext {
  return {
    isAsync: false,
    context: [],
    variables: Object.create(null),
    model,
    environment: () => undefined,
    modelEquivalence: undefined,
    lenientChoiceSuffix: false,
    units: minimalUnitSystem,
    timezoneOffset: 0,
    now: () => {
      throw new Error('not used');
    },
    trace: undefined,
    limits: { maxRepeatItems: 5_000 },
  };
}

const modelLess = context();
const withModel = context(stubModel);

function errorCode(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

// https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#type-names-that-do-not-resolve
describe('resolveTypeTarget', () => {
  it('resolves System names, qualified or not', () => {
    expect(resolveTypeTarget({ name: 'String' }, undefined)).toEqual({
      kind: 'type',
      type: SYSTEM_TYPES.String,
    });
    expect(resolveTypeTarget({ namespace: 'System', name: 'Integer' }, stubModel)).toEqual({
      kind: 'type',
      type: SYSTEM_TYPES.Integer,
    });
  });

  it('resolves model names with a model, the model namespace first', () => {
    expect(resolveTypeTarget({ name: 'Patient' }, stubModel)).toEqual({
      kind: 'type',
      type: stubType('Patient'),
    });
    expect(resolveTypeTarget({ namespace: 'FHIR', name: 'code' }, stubModel)).toEqual({
      kind: 'type',
      type: stubType('code'),
    });
  });

  // https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#resource-type-names-without-a-model
  it('makes any other unqualified name a resource name without a model', () => {
    for (const name of ['Patient', 'Pateint', 'string', 'Resource']) {
      expect(resolveTypeTarget({ name }, undefined)).toEqual({ kind: 'resource', name });
    }
  });

  it.each<[string | undefined, string, boolean]>([
    ['System', 'Patient', false],
    ['FHIR', 'Patient', false],
    ['Foo', 'Patient', false],
    ['System', 'Patient', true],
    ['FHIR', 'Boolean', true],
    ['Foo', 'Patient', true],
    [undefined, 'string1', true],
  ])('leaves %s.%s unresolved (with a model: %s)', (namespace, name, hasModel) => {
    const specifier = namespace === undefined ? { name } : { namespace, name };
    expect(resolveTypeTarget(specifier, hasModel ? stubModel : undefined).kind).toBe('unresolved');
  });
});

describe('systemTypeOf', () => {
  it.each<[Item, string]>([
    [true, 'Boolean'],
    ['a', 'String'],
    [1, 'Integer'],
    [1n, 'Long'],
    [Decimal.ONE, 'Decimal'],
    [new Quantity(Decimal.ONE, 'mg'), 'Quantity'],
  ])('gives the type of %s', (value, name) => {
    expect(systemTypeOf(value)?.name).toBe(name);
  });

  it('gives Date for a Date', () => {
    const date = DateValue.tryCreate({ year: 2020 });
    expect(date === undefined ? undefined : systemTypeOf(date)).toBe(SYSTEM_TYPES.Date);
  });

  it('gives no type for an input node', () => {
    expect(systemTypeOf(new ModelNode({ value: 'a', name: 'a' }))).toBeUndefined();
  });
});

describe('matchesTypeTarget', () => {
  const [patient] = toInputCollection({ resourceType: 'Patient' }, 'r');
  const [text] = toInputCollection('Patient', 'r');
  const any: TypeTarget = { kind: 'type', type: SYSTEM_TYPES.Any };

  it('matches System.Any for every item, including untyped objects', () => {
    for (const item of [patient, text, 1, Decimal.ONE]) {
      expect(item !== undefined && matchesTypeTarget(item, any, modelLess)).toBe(true);
    }
  });

  it('matches input primitives by the System type of their value', () => {
    const string: TypeTarget = { kind: 'type', type: SYSTEM_TYPES.String };
    expect(text !== undefined && matchesTypeTarget(text, string, modelLess)).toBe(true);
    expect(patient !== undefined && matchesTypeTarget(patient, string, modelLess)).toBe(false);
  });

  it('matches a resource name on the own resourceType only', () => {
    const target: TypeTarget = { kind: 'resource', name: 'Patient' };
    expect(patient !== undefined && matchesTypeTarget(patient, target, modelLess)).toBe(true);
    expect(text !== undefined && matchesTypeTarget(text, target, modelLess)).toBe(false);
    expect(matchesTypeTarget('Patient', target, modelLess)).toBe(false);
  });

  // https://github.com/losol/callis/blob/main/docs/spec-notes.md#fhir-primitives-in-is-as-and-oftype
  it('tests typed nodes with the model, and maps primitives to System only for ofType', () => {
    const gender = new ModelNode({ value: 'male', name: 'gender', type: stubType('code') });
    const string: TypeTarget = { kind: 'type', type: stubType('string') };
    const systemString: TypeTarget = { kind: 'type', type: SYSTEM_TYPES.String };
    expect(matchesTypeTarget(gender, string, withModel)).toBe(true);
    expect(matchesTypeTarget(gender, systemString, withModel, 'is')).toBe(false);
    expect(matchesTypeTarget(gender, systemString, withModel, 'ofType')).toBe(true);
  });

  it('raises eval/unknown-type for an unresolved target', () => {
    const target: TypeTarget = { kind: 'unresolved', specifier: { namespace: 'Foo', name: 'Bar' } };
    expect(errorCode(() => matchesTypeTarget(1, target, modelLess))).toBe('eval/unknown-type');
  });

  // https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#resource-type-names-without-a-model
  it('tests typed nodes by the model inheritance', () => {
    const [typed] = toInputCollection({ resourceType: 'Patient' }, 'r', stubModel);
    const target = (name: string): TypeTarget => ({ kind: 'type', type: stubType(name) });
    expect(typed !== undefined && matchesTypeTarget(typed, target('Patient'), withModel)).toBe(
      true,
    );
    expect(
      typed !== undefined && matchesTypeTarget(typed, target('DomainResource'), withModel),
    ).toBe(true);
    expect(typed !== undefined && matchesTypeTarget(typed, target('Observation'), withModel)).toBe(
      false,
    );
    expect(typed !== undefined && matchesTypeTarget(typed, target('HumanName'), withModel)).toBe(
      false,
    );
  });

  it('never matches an untyped object by its resourceType when a model is supplied', () => {
    const [untyped] = toInputCollection({ resourceType: 'Foo' }, 'r', stubModel);
    expect(untyped).toBeInstanceOf(ModelNode);
    expect((untyped as ModelNode).type).toBeUndefined();
    const target: TypeTarget = { kind: 'type', type: stubType('Patient') };
    expect(untyped !== undefined && matchesTypeTarget(untyped, target, withModel)).toBe(false);
    expect(untyped !== undefined && matchesTypeTarget(untyped, any, withModel)).toBe(true);
    // The name of its data is not a type of the model, so it does not even resolve.
    expect(resolveTypeTarget({ name: 'Foo' }, stubModel).kind).toBe('unresolved');
  });
});

describe('isType and asType', () => {
  const integer: TypeTarget = { kind: 'type', type: SYSTEM_TYPES.Integer };
  const unknown: TypeTarget = {
    kind: 'unresolved',
    specifier: { namespace: 'System', name: 'Patient' },
  };

  // https://hl7.org/fhirpath/STU3/en/#is-type-specifier
  it('gives false for is and empty for as on empty input', () => {
    expect(isType([], integer, modelLess)).toBe(false);
    expect(asType([], integer, modelLess)).toEqual([]);
  });

  it('keeps the item itself for a match', () => {
    const [node] = toInputCollection(5, 'n');
    const input = node === undefined ? [] : [node];
    expect(isType(input, integer, modelLess)).toBe(true);
    expect(asType(input, integer, modelLess)[0]).toBe(node);
  });

  it('raises eval/unknown-type before looking at the input, even when it is empty', () => {
    expect(errorCode(() => isType([], unknown, modelLess))).toBe('eval/unknown-type');
    expect(errorCode(() => asType([1, 2], unknown, modelLess))).toBe('eval/unknown-type');
  });

  it('raises eval/singleton-expected for more than one item', () => {
    expect(errorCode(() => isType([1, 2], integer, modelLess))).toBe('eval/singleton-expected');
    expect(errorCode(() => asType([1, 2], integer, modelLess))).toBe('eval/singleton-expected');
  });
});
