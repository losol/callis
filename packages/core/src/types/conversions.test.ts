import { describe, expect, it } from 'vitest';
import { canConvertImplicitly, IMPLICIT_CONVERSIONS } from './conversions.ts';
import { isSystemTypeName, SYSTEM_TYPES, type SystemTypeName } from './system-types.ts';

const NAMES: readonly SystemTypeName[] = Object.keys(SYSTEM_TYPES).filter(isSystemTypeName);

// https://hl7.org/fhirpath/N1/#conversion: the "Implicit" cells of the conversion table.
const IMPLICIT: ReadonlyArray<readonly [SystemTypeName, SystemTypeName]> = [
  ['Integer', 'Decimal'],
  ['Integer', 'Quantity'],
  ['Decimal', 'Quantity'],
  ['Date', 'DateTime'],
];

describe('IMPLICIT_CONVERSIONS', () => {
  it('lists exactly the implicit conversions of N1 §5.5', () => {
    const listed = NAMES.flatMap((from) => IMPLICIT_CONVERSIONS[from].map((to) => [from, to]));
    expect(listed).toEqual(IMPLICIT);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(IMPLICIT_CONVERSIONS)).toBe(true);
    for (const name of NAMES) {
      expect(Object.isFrozen(IMPLICIT_CONVERSIONS[name])).toBe(true);
    }
  });
});

describe('canConvertImplicitly', () => {
  it.each(IMPLICIT)('converts %s to %s', (from, to) => {
    expect(canConvertImplicitly(from, to)).toBe(true);
  });

  it.each(NAMES)('converts %s to itself', (name) => {
    expect(canConvertImplicitly(name, name)).toBe(true);
  });

  it.each<[SystemTypeName, SystemTypeName]>([
    ['Decimal', 'Integer'], // implicit conversions only widen
    ['Quantity', 'Decimal'],
    ['DateTime', 'Date'],
    ['String', 'Integer'], // explicit only (toInteger)
    ['Integer', 'String'], // explicit only (toString)
    ['Boolean', 'Integer'],
    ['Integer', 'Boolean'],
    ['Date', 'Time'],
    ['Integer', 'Any'], // Any is a supertype, not a conversion target
    ['Integer', 'Long'], // phase 2 (T0028)
  ])('does not convert %s to %s', (from, to) => {
    expect(canConvertImplicitly(from, to)).toBe(false);
  });
});
