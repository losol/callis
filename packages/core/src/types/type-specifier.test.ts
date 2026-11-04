import { describe, expect, it } from 'vitest';
import { stubModel, stubType } from '../../test/support/stub-model.ts';
import { SYSTEM_TYPES } from './system-types.ts';
import {
  resolveTypeSpecifier,
  type TypeSpecifier,
  typeSpecifierFromIdentifiers,
} from './type-specifier.ts';

// https://hl7.org/fhirpath/N1/#models: "When resolving a type name, the context-specific model is
// searched first. If no match is found, the System model ... is searched."
describe('resolveTypeSpecifier with a model', () => {
  it.each<[string, TypeSpecifier, string]>([
    // The model is searched first: FHIR defines Quantity, so it shadows System.Quantity.
    ['Quantity', { name: 'Quantity' }, 'FHIR.Quantity'],
    ['Patient (testType17)', { name: 'Patient' }, 'FHIR.Patient'],
    ['boolean (testType11)', { name: 'boolean' }, 'FHIR.boolean'],
    // Not in the model, so System: names are case-sensitive (testType12, testType5).
    ['Boolean', { name: 'Boolean' }, 'System.Boolean'],
    ['Integer', { name: 'Integer' }, 'System.Integer'],
    ['Any', { name: 'Any' }, 'System.Any'],
  ])('resolves the unqualified name %s', (_label, specifier, expected) => {
    const type = resolveTypeSpecifier(specifier, stubModel);
    expect(type && `${type.namespace}.${type.name}`).toBe(expected);
  });

  it('returns the provider’s own type object and the shared System type objects', () => {
    expect(resolveTypeSpecifier({ name: 'Patient' }, stubModel)).toBe(stubType('Patient'));
    expect(resolveTypeSpecifier({ name: 'Integer' }, stubModel)).toBe(SYSTEM_TYPES.Integer);
  });

  it.each<[string, TypeSpecifier, string]>([
    ['FHIR.Patient (testType18)', { namespace: 'FHIR', name: 'Patient' }, 'FHIR.Patient'],
    ['FHIR.boolean (testType13)', { namespace: 'FHIR', name: 'boolean' }, 'FHIR.boolean'],
    ['FHIR.Quantity', { namespace: 'FHIR', name: 'Quantity' }, 'FHIR.Quantity'],
    // Qualified with System, the model's Quantity is skipped.
    ['System.Quantity', { namespace: 'System', name: 'Quantity' }, 'System.Quantity'],
    ['System.Boolean (testType6)', { namespace: 'System', name: 'Boolean' }, 'System.Boolean'],
    [
      'FHIR.Patient.contact',
      { namespace: 'FHIR', name: 'Patient.contact' },
      'FHIR.Patient.contact',
    ],
  ])('resolves the qualified name %s directly', (_label, specifier, expected) => {
    const type = resolveTypeSpecifier(specifier, stubModel);
    expect(type && `${type.namespace}.${type.name}`).toBe(expected);
  });

  it.each<[string, TypeSpecifier]>([
    // A qualified name does not fall back to the other namespace.
    ['System.Patient (testType22)', { namespace: 'System', name: 'Patient' }],
    ['FHIR.Boolean', { namespace: 'FHIR', name: 'Boolean' }],
    ['FHIR.Integer', { namespace: 'FHIR', name: 'Integer' }],
    ['an unknown namespace', { namespace: 'CDA', name: 'Patient' }],
    ['a namespace in the wrong case', { namespace: 'fhir', name: 'Patient' }],
    ['an unknown name (testFHIRPathAsFunction23)', { name: 'string1' }],
    ['a name in the wrong case', { name: 'patient' }],
    ['a backbone path read as namespace and name', { namespace: 'Patient', name: 'contact' }],
  ])('does not resolve %s', (_label, specifier) => {
    expect(resolveTypeSpecifier(specifier, stubModel)).toBeUndefined();
  });

  it.each([['constructor'], ['__proto__'], ['toString'], ['hasOwnProperty']])(
    'does not resolve the prototype member %s in either namespace',
    (name) => {
      expect(resolveTypeSpecifier({ name }, stubModel)).toBeUndefined();
      expect(resolveTypeSpecifier({ namespace: 'System', name }, stubModel)).toBeUndefined();
      expect(resolveTypeSpecifier({ namespace: 'FHIR', name }, stubModel)).toBeUndefined();
    },
  );
});

describe('resolveTypeSpecifier without a model', () => {
  it.each<[TypeSpecifier, unknown]>([
    [{ name: 'Integer' }, SYSTEM_TYPES.Integer],
    [{ name: 'Quantity' }, SYSTEM_TYPES.Quantity],
    [{ namespace: 'System', name: 'DateTime' }, SYSTEM_TYPES.DateTime],
    [{ name: 'Patient' }, undefined],
    [{ namespace: 'FHIR', name: 'Patient' }, undefined],
    [{ name: 'boolean' }, undefined],
  ])('resolves %j to System types only', (specifier, expected) => {
    expect(resolveTypeSpecifier(specifier)).toBe(expected);
  });
});

describe('typeSpecifierFromIdentifiers', () => {
  it.each<[readonly [string, ...string[]], TypeSpecifier]>([
    [['Patient'], { name: 'Patient' }],
    [['FHIR', 'Patient'], { namespace: 'FHIR', name: 'Patient' }],
    [['System', 'String'], { namespace: 'System', name: 'String' }],
    [['FHIR', 'Patient', 'contact'], { namespace: 'FHIR', name: 'Patient.contact' }],
  ])('reads %j', (identifiers, expected) => {
    expect(typeSpecifierFromIdentifiers(identifiers)).toEqual(expected);
  });
});
