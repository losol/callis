import { describe, expect, expectTypeOf, it } from 'vitest';
import { stubModel, stubType } from '../../test/support/stub-model.ts';
import type { ModelTypes } from '../types/model-types.ts';
import type { ModelProvider, ModelTypeInfo } from './model-provider.ts';

// The interface is a contract for T0018 and T0019. These tests pin down its shape and show the
// behaviour it documents, using the stub model as an example implementation.
describe('ModelProvider', () => {
  it('satisfies the part of a model that the type system uses', () => {
    expectTypeOf<ModelProvider>().toExtend<ModelTypes<ModelTypeInfo>>();
  });

  it('names backbone types by path and gives their base type', () => {
    expect(stubModel.getType('Patient.contact')).toEqual({
      namespace: 'FHIR',
      name: 'Patient.contact',
      kind: 'backbone',
      baseName: 'BackboneElement',
      isAbstract: false,
    });
  });

  it('returns the same object for the same type', () => {
    expect(stubModel.getType('Patient')).toBe(stubModel.getType('Patient'));
  });

  it('lists inherited elements first, in definition order', () => {
    const names = stubModel.getElements(stubType('Patient')).map((element) => element.name);

    expect(names).toEqual([
      'id',
      'contained',
      'extension',
      'active',
      'name',
      'birthDate',
      'contact',
    ]);
  });

  it('does not list the implicit value of a primitive type', () => {
    const names = stubModel.getElements(stubType('code')).map((element) => element.name);

    expect(names).toEqual(['id', 'extension']);
  });

  it('finds a choice element by its name without [x], not by a JSON key', () => {
    const observation = stubType('Observation');

    expect(stubModel.getElement(observation, 'value')).toMatchObject({
      isChoice: true,
      typeNames: ['Quantity', 'string', 'boolean'],
    });
    expect(stubModel.getElement(observation, 'valueQuantity')).toBeUndefined();
  });

  it('finds inherited elements', () => {
    expect(stubModel.getElement(stubType('Patient'), 'id')?.typeNames).toEqual(['id']);
  });

  it('lists element types that all resolve with getType()', () => {
    for (const name of ['Patient', 'Observation', 'Patient.contact', 'Quantity', 'Extension']) {
      for (const element of stubModel.getElements(stubType(name))) {
        for (const typeName of element.typeNames) {
          expect(stubModel.getType(typeName), `${name}.${element.name}`).toBeDefined();
        }
      }
    }
  });

  it('treats isSubtypeOf as reflexive', () => {
    expect(stubModel.isSubtypeOf(stubType('Patient'), stubType('Patient'))).toBe(true);
  });

  it.each([['constructor'], ['__proto__'], ['toString'], ['hasOwnProperty']])(
    'does not reach the prototype member %s',
    (name) => {
      expect(stubModel.getType(name)).toBeUndefined();
      expect(stubModel.getElement(stubType('Patient'), name)).toBeUndefined();
    },
  );

  it('takes the root type from an own resourceType property only', () => {
    const inherited: object = Object.create({ resourceType: 'Patient' });

    expect(stubModel.getRootType({ resourceType: 'Patient' })).toBe(stubType('Patient'));
    expect(stubModel.getRootType(inherited)).toBeUndefined();
    expect(stubModel.getRootType({ resourceType: 'HumanName' })).toBeUndefined();
    expect(stubModel.getRootType({ resourceType: 42 })).toBeUndefined();
    expect(stubModel.getRootType({})).toBeUndefined();
  });

  it('maps FHIR.date to System.Date', () => {
    expect(stubModel.getSystemType(stubType('date'))).toBe('Date');
  });
});
