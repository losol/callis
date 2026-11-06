import { readXmlElements, type XmlElement } from './xml-elements.ts';

/** A prefix such as `k`, with its value as decimal text (`1e3`). */
export interface EssencePrefix {
  readonly code: string;
  readonly value: string;
}

/** One of the seven base units, such as `m` with dimension `L`. */
export interface EssenceBaseUnit {
  readonly code: string;
  readonly dimension: string;
}

/** The conversion function of a special unit, such as `Cel` with `value` 1 and `unit` `K`. */
export interface EssenceFunction {
  readonly name: string;
  readonly value: string;
  readonly unit: string;
}

/** A defined unit: `value` times the unit expression `unit`, or a special unit's function. */
export interface EssenceUnit {
  readonly code: string;
  readonly isMetric: boolean;
  readonly isSpecial: boolean;
  readonly isArbitrary: boolean;
  readonly unit: string;
  readonly value: string | undefined;
  readonly function: EssenceFunction | undefined;
}

/** The parts of the UCUM essence file that unit conversion needs, in document order. */
export interface EssenceData {
  readonly version: string;
  readonly revisionDate: string;
  readonly prefixes: readonly EssencePrefix[];
  readonly baseUnits: readonly EssenceBaseUnit[];
  readonly units: readonly EssenceUnit[];
}

/**
 * Reads prefixes, base units and units from the text of `ucum-essence.xml`. Only the case-sensitive
 * `Code` attributes are used. Names, print symbols and the other descriptive content are skipped.
 *
 * @returns the definitions, or `undefined` if the text is not a well-formed essence document.
 * @see https://ucum.org/ucum#section-Character-Set-and-Lexical-Rules
 */
export function readEssence(xml: string): EssenceData | undefined {
  const root = readXmlElements(xml);
  if (root === undefined || root.name !== 'root') return undefined;
  const prefixes: EssencePrefix[] = [];
  const baseUnits: EssenceBaseUnit[] = [];
  const units: EssenceUnit[] = [];
  for (const element of root.children) {
    const code = element.attributes.get('Code');
    if (element.name === 'prefix') {
      const value = child(element, 'value')?.attributes.get('value');
      if (code === undefined || value === undefined) return undefined;
      prefixes.push({ code, value });
    } else if (element.name === 'base-unit') {
      const dimension = element.attributes.get('dim');
      if (code === undefined || dimension === undefined) return undefined;
      baseUnits.push({ code, dimension });
    } else if (element.name === 'unit') {
      const unit = readUnit(element, code);
      if (unit === undefined) return undefined;
      units.push(unit);
    }
  }
  return {
    version: root.attributes.get('version') ?? '',
    revisionDate: root.attributes.get('revision-date') ?? '',
    prefixes,
    baseUnits,
    units,
  };
}

function readUnit(element: XmlElement, code: string | undefined): EssenceUnit | undefined {
  const value = child(element, 'value');
  const unit = value?.attributes.get('Unit');
  if (code === undefined || value === undefined || unit === undefined) return undefined;
  const fn = child(value, 'function');
  let definition: EssenceFunction | undefined;
  if (fn !== undefined) {
    const name = fn.attributes.get('name');
    const fnValue = fn.attributes.get('value');
    const fnUnit = fn.attributes.get('Unit');
    if (name === undefined || fnValue === undefined || fnUnit === undefined) return undefined;
    definition = { name, value: fnValue, unit: fnUnit };
  }
  const isSpecial = element.attributes.get('isSpecial') === 'yes';
  // A special unit is defined by its function; every other unit by a value and a unit term.
  if (isSpecial !== (definition !== undefined)) return undefined;
  const factor = value.attributes.get('value');
  if (!isSpecial && factor === undefined) return undefined;
  return {
    code,
    isMetric: element.attributes.get('isMetric') === 'yes',
    isSpecial,
    isArbitrary: element.attributes.get('isArbitrary') === 'yes',
    unit,
    value: factor,
    function: definition,
  };
}

function child(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((candidate) => candidate.name === name);
}
