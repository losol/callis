import { describe, expect, it } from 'vitest';
import { stubType } from '../../test/support/stub-model.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { ModelNode } from './model-node.ts';

describe('ModelNode', () => {
  it('keeps every field it is given', () => {
    const patient = new ModelNode({ value: { resourceType: 'Patient' }, name: 'Patient' });
    const primitiveElement = { extension: [] };
    const given = new ModelNode({
      value: 'Peter',
      name: 'given',
      type: stubType('string'),
      systemType: 'String',
      parent: patient,
      index: 1,
      primitiveElement,
    });

    expect(given.value).toBe('Peter');
    expect(given.name).toBe('given');
    expect(given.type).toBe(stubType('string'));
    expect(given.systemType).toBe('String');
    expect(given.parent).toBe(patient);
    expect(given.index).toBe(1);
    expect(given.primitiveElement).toBe(primitiveElement);
  });

  it('sets the optional fields to undefined when they are not given', () => {
    const node = new ModelNode({ value: true, name: 'active' });

    expect(node.type).toBeUndefined();
    expect(node.systemType).toBeUndefined();
    expect(node.parent).toBeUndefined();
    expect(node.index).toBeUndefined();
    expect(node.primitiveElement).toBeUndefined();
  });

  it('allows an undefined value for a primitive that only has extensions', () => {
    // https://hl7.org/fhir/R4/json.html#primitive
    const node = new ModelNode({ value: undefined, name: 'birthDate', primitiveElement: {} });

    expect(node.value).toBeUndefined();
    expect(node.primitiveElement).toEqual({});
  });

  it('gives every node the same own properties in the same order', () => {
    const bare = new ModelNode({ value: 1, name: 'a' });
    const full = new ModelNode({
      value: 1,
      name: 'a',
      type: stubType('integer'),
      systemType: 'Integer',
      parent: bare,
      index: 0,
      primitiveElement: {},
    });

    expect(Object.keys(bare)).toEqual(Object.keys(full));
  });

  it('computes its System value once and remembers it', () => {
    const value = new ModelNode({ value: 1.5, name: 'value' });
    const first = value.systemValue();
    expect(first).toBeInstanceOf(Decimal);
    expect(value.systemValue()).toBe(first);
    expect(value.value).toBe(1.5);
  });
});
