import { describe, expect, it } from 'vitest';
import {
  findSystemType,
  isSystemType,
  isSystemTypeName,
  SYSTEM_TYPES,
  type SystemTypeName,
} from './system-types.ts';

// https://hl7.org/fhirpath/N1/#literals
const NAMES: readonly SystemTypeName[] = [
  'Any',
  'Boolean',
  'String',
  'Integer',
  'Long',
  'Decimal',
  'Date',
  'DateTime',
  'Time',
  'Quantity',
];

describe('SYSTEM_TYPES', () => {
  it('has one frozen System type per name', () => {
    expect(Object.keys(SYSTEM_TYPES).sort()).toEqual([...NAMES].sort());
    for (const name of NAMES) {
      expect(SYSTEM_TYPES[name]).toEqual({ namespace: 'System', name });
      expect(Object.isFrozen(SYSTEM_TYPES[name])).toBe(true);
    }
    expect(Object.isFrozen(SYSTEM_TYPES)).toBe(true);
  });
});

describe('findSystemType', () => {
  it.each(NAMES)('finds %s as the shared object', (name) => {
    expect(findSystemType(name)).toBe(SYSTEM_TYPES[name]);
  });

  it.each([
    ['boolean'], // names are case-sensitive; FHIR.boolean is a model type
    ['string'],
    ['Patient'],
    ['System.String'], // takes an unqualified name
    [''],
  ])('does not find %j', (name) => {
    expect(findSystemType(name)).toBeUndefined();
    expect(isSystemTypeName(name)).toBe(false);
  });

  it.each([['constructor'], ['__proto__'], ['toString'], ['hasOwnProperty'], ['valueOf']])(
    'does not find the prototype member %s',
    (name) => {
      expect(findSystemType(name)).toBeUndefined();
      expect(isSystemTypeName(name)).toBe(false);
    },
  );
});

describe('isSystemType', () => {
  it('is true for System types and false for model types', () => {
    expect(isSystemType(SYSTEM_TYPES.Integer)).toBe(true);
    expect(isSystemType({ namespace: 'FHIR', name: 'integer' })).toBe(false);
  });
});
