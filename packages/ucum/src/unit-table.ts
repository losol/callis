import type { Atom, SpecialScale, UnitLookup } from './atom.ts';
import { axis, combineDimensions } from './dimension.ts';
import type { EssenceData, EssenceUnit } from './essence/essence-reader.ts';
import { MAX_MAGNITUDE_BITS, multiply, ONE, parseDecimalText, type Rational } from './rational.ts';
import { resolveUnit } from './resolve-unit.ts';

/**
 * The special-unit functions Callis converts, by function name in the essence file. Each is the
 * affine relation `proper = (value + offset) × magnitude`: `Cel` gives kelvin = °C + 273.15, and
 * `degF` gives (5/9 K) multiples = °F + 459.67. The essence file names these functions; their
 * definitions come from the UCUM specification text. Other special units are not convertible.
 * @see https://ucum.org/ucum#section-Special-Units-on-non-ratio-Scales
 */
const AFFINE_OFFSETS: Readonly<Record<string, Rational>> = Object.freeze({
  Cel: Object.freeze({ numerator: 5463n, denominator: 20n }), // 273.15
  degF: Object.freeze({ numerator: 45967n, denominator: 100n }), // 459.67
});

/** A lookup that knows no units, for when the essence data cannot be read. */
export const EMPTY_UNIT_LOOKUP: UnitLookup = Object.freeze({
  hasAtom: () => false,
  isMetric: () => false,
  atom: () => undefined,
  prefix: () => undefined,
  prefixCodes: Object.freeze([]),
});

/**
 * Resolves every prefix, base unit and unit of the essence data to a magnitude and dimension in
 * base units. Definitions refer to other units, so each atom is resolved once, on first need.
 * An atom whose definition is invalid, circular or out of bounds is left out.
 */
export function buildUnitTable(data: EssenceData): UnitLookup {
  const prefixes = new Map<string, Rational>();
  for (const prefix of data.prefixes) {
    const value = parseDecimalText(prefix.value);
    if (value !== undefined && value.numerator > 0n) prefixes.set(prefix.code, value);
  }
  const atoms = new Map<string, Atom>();
  for (const base of data.baseUnits) {
    atoms.set(base.code, {
      code: base.code,
      isMetric: true,
      magnitude: ONE,
      dimension: axis(base.code),
      arbitrary: false,
      special: undefined,
    });
  }
  const definitions = new Map<string, EssenceUnit>();
  for (const unit of data.units) {
    if (!atoms.has(unit.code) && !definitions.has(unit.code)) definitions.set(unit.code, unit);
  }
  const prefixCodes = Object.freeze(
    [...prefixes.keys()].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0)),
  );
  const pending = new Set<string>();
  const failed = new Set<string>();

  const lookup: UnitLookup = {
    hasAtom: (code) => atoms.has(code) || definitions.has(code),
    isMetric: (code) => atoms.get(code)?.isMetric ?? definitions.get(code)?.isMetric ?? false,
    atom: (code) => {
      const known = atoms.get(code);
      if (known !== undefined) return known;
      const definition = definitions.get(code);
      if (definition === undefined || pending.has(code) || failed.has(code)) return undefined;
      pending.add(code);
      const atom = defineAtom(definition, lookup);
      pending.delete(code);
      if (atom === undefined) failed.add(code);
      else atoms.set(code, atom);
      return atom;
    },
    prefix: (code) => prefixes.get(code),
    prefixCodes,
  };
  for (const code of definitions.keys()) lookup.atom(code);

  return Object.freeze({
    hasAtom: (code: string) => atoms.has(code),
    isMetric: (code: string) => atoms.get(code)?.isMetric ?? false,
    atom: (code: string) => atoms.get(code),
    prefix: (code: string) => prefixes.get(code),
    prefixCodes,
  });
}

function defineAtom(definition: EssenceUnit, lookup: UnitLookup): Atom | undefined {
  const source = definition.function ?? { value: definition.value ?? '', unit: definition.unit };
  const value = parseDecimalText(source.value);
  const unit = resolveUnit(source.unit, lookup);
  if (
    value === undefined ||
    value.numerator <= 0n ||
    unit === undefined ||
    unit.special !== undefined
  ) {
    return undefined;
  }
  const magnitude = multiply(value, unit.magnitude, MAX_MAGNITUDE_BITS);
  if (magnitude === undefined) return undefined;
  let special: SpecialScale | undefined;
  if (definition.function !== undefined) {
    const name = definition.function.name;
    const offset = Object.hasOwn(AFFINE_OFFSETS, name) ? AFFINE_OFFSETS[name] : undefined;
    special = offset === undefined ? { kind: 'unsupported' } : { kind: 'affine', offset };
  }
  // §24: an arbitrary unit is its own dimension, commensurable with nothing else.
  const dimension = definition.isArbitrary
    ? combineDimensions(unit.dimension, axis(definition.code))
    : unit.dimension;
  if (dimension === undefined) return undefined;
  return {
    code: definition.code,
    isMetric: definition.isMetric,
    magnitude,
    dimension,
    arbitrary: definition.isArbitrary || unit.arbitrary,
    special,
  };
}
