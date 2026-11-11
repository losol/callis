/**
 * What static analysis knows about the value of an expression node: the types its items may
 * have, how many items there may be, and whether their order is defined
 * ([T0024: design notes](https://github.com/losol/callis/blob/main/docs/tasks/T0024-static-analysis.md#design-notes)).
 *
 * Every rule here errs on the side of not knowing. A type set is a list of the possible types,
 * `undefined` when nothing is known, so a check only fires when every possibility is wrong, and
 * never for an unknown value.
 */
import type { TypeExpectation } from '../functions/define.ts';
import type { ModelProvider, ModelTypeInfo } from '../model/model-provider.ts';
import {
  isSystemType,
  SYSTEM_TYPES,
  type SystemType,
  type SystemTypeName,
} from '../types/system-types.ts';
import { isOfType, isSameType, matchesOfType } from '../types/type-test.ts';

/** A type an expression may evaluate to: a System type or a type of the model. */
export type AnalysisType = SystemType | ModelTypeInfo;

/**
 * The possible types of the items of a value: `undefined` when unknown, empty when no item is
 * possible (the empty literal, or an operand that a type guard makes unreachable). A set never
 * contains `System.Any`, which stands for "unknown".
 */
export type TypeSet = readonly AnalysisType[] | undefined;

/**
 * How many items a value may have: at most one, possibly more (a repeating element, a union), or
 * unknown. Strict mode (T0024b) reports `collection` where one item is expected, never `unknown`.
 */
export type Cardinality = 'single' | 'collection' | 'unknown';

/** What is known about a value. */
export interface Inferred {
  readonly types: TypeSet;
  readonly cardinality: Cardinality;
}

/** Nothing is known. */
export const UNKNOWN: Inferred = Object.freeze({ types: undefined, cardinality: 'unknown' });

/** No item is possible: the empty literal, or a branch a type guard rules out. */
export const NOTHING: Inferred = Object.freeze({ types: Object.freeze([]), cardinality: 'single' });

/** A single value of a System type, such as a literal or the result of `count()`. */
export function singleOf(name: Exclude<SystemTypeName, 'Any'>): Inferred {
  return { types: [SYSTEM_TYPES[name]], cardinality: 'single' };
}

/** Whether a value cannot have any item, so nothing about it needs checking. */
export function isNothing(inferred: Inferred): boolean {
  return inferred.types !== undefined && inferred.types.length === 0;
}

/** Whether the possible types are known: neither unknown nor empty. */
export function hasKnownTypes(
  inferred: Inferred,
): inferred is Inferred & { readonly types: readonly AnalysisType[] } {
  return inferred.types !== undefined && inferred.types.length > 0;
}

/**
 * A type set from a list of types: without repeats, and unknown when the list has `System.Any`,
 * which can be anything.
 */
export function typeSetOf(types: readonly (AnalysisType | undefined)[]): TypeSet {
  const result: AnalysisType[] = [];
  for (const type of types) {
    if (type === undefined || (isSystemType(type) && type.name === 'Any')) {
      return undefined;
    }
    if (!result.some((other) => isSameType(other, type))) {
      result.push(type);
    }
  }
  return result;
}

/** The types of both sets, or unknown when either is unknown. */
export function unionTypes(a: TypeSet, b: TypeSet): TypeSet {
  return a === undefined || b === undefined ? undefined : typeSetOf([...a, ...b]);
}

/**
 * The System type that values of a type have or convert to: the type itself for a System type,
 * what the model maps a model type to (`FHIR.date` → `Date`, `FHIR.Quantity` → `Quantity`), and
 * undefined for a resource or a complex value, which has no System value. `Any` is not a value
 * type, so it gives undefined too.
 */
export function systemNameOf(
  type: AnalysisType,
  model: ModelProvider | undefined,
): Exclude<SystemTypeName, 'Any'> | undefined {
  if (isSystemType(type)) {
    return type.name === 'Any' ? undefined : type.name;
  }
  return model?.getSystemType(type);
}

/**
 * Whether values of a type are accepted where `expected` is: the type itself, or one that
 * converts to it implicitly ([N1 §5.5](https://hl7.org/fhirpath/N1/#conversion), with the
 * number-to-Quantity conversion of [3.0.0](https://hl7.org/fhirpath/STU3/#conversion)).
 */
export function convertsTo(
  type: AnalysisType,
  expected: SystemTypeName,
  model: ModelProvider | undefined,
): boolean {
  if (expected === 'Any') {
    return true;
  }
  const name = systemNameOf(type, model);
  if (name === undefined) {
    return false;
  }
  switch (expected) {
    case 'Decimal':
      return name === 'Decimal' || name === 'Integer';
    case 'Quantity':
      return name === 'Quantity' || name === 'Integer' || name === 'Decimal';
    case 'DateTime':
      return name === 'DateTime' || name === 'Date';
    default:
      return name === expected;
  }
}

/** Whether a type fits what a function expects of its input or an argument. */
export function fitsExpectation(
  type: AnalysisType,
  expected: NonNullable<TypeExpectation['type']>,
  model: ModelProvider | undefined,
): boolean {
  if (expected === 'primitive') {
    return systemNameOf(type, model) !== undefined;
  }
  if (typeof expected === 'string') {
    return convertsTo(type, expected, model);
  }
  return expected.some((name) => convertsTo(type, name, model));
}

/**
 * Whether some possible type fits the expectation. True when the types are unknown or no item is
 * possible: a check fires only when every possibility is wrong.
 */
export function someFits(
  types: TypeSet,
  expected: NonNullable<TypeExpectation['type']>,
  model: ModelProvider | undefined,
): boolean {
  return (
    types === undefined ||
    types.length === 0 ||
    types.some((type) => fitsExpectation(type, expected, model))
  );
}

/**
 * How a type is narrowed by a type target: `is` keeps a model primitive only for its own type,
 * `ofType` also for the System type it converts to
 * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#fhir-primitives-in-is-as-and-oftype)).
 */
export type NarrowingRule = 'is' | 'ofType';

/**
 * The types that remain when the value is known to be one of the targets, as after `as`,
 * `ofType()` or a true `is` guard. A possible type that is a target or a subtype of one stays; a
 * possible supertype of a target (`Element` when the target is `Period`) becomes that target; any
 * other type is dropped. Unknown types narrow to the targets themselves.
 */
export function narrowTo(
  types: TypeSet,
  targets: readonly AnalysisType[],
  model: ModelProvider | undefined,
  rule: NarrowingRule,
): TypeSet {
  if (types === undefined) {
    return typeSetOf(targets);
  }
  const result: AnalysisType[] = [];
  for (const type of types) {
    for (const target of targets) {
      if (
        isOfType(type, target, model) ||
        (rule === 'ofType' && matchesOfType(type, target, model))
      ) {
        result.push(type);
      } else if (isOfType(target, type, model)) {
        result.push(target);
      }
    }
  }
  return typeSetOf(result);
}

/**
 * The types that remain when the value is known not to be any of the targets, as after a false
 * `is` guard: a possible type that is a target or a subtype of one is dropped. A supertype stays,
 * because the value may be another subtype of it. Unknown types stay unknown.
 */
export function excludeTypes(
  types: TypeSet,
  targets: readonly AnalysisType[],
  model: ModelProvider | undefined,
): TypeSet {
  if (types === undefined) {
    return undefined;
  }
  return types.filter((type) => !targets.some((target) => isOfType(type, target, model)));
}

/**
 * The types for people, as in `Period or Timing`; a long list, such as the types of a choice
 * element, is cut short: `Quantity, CodeableConcept, string or 8 other types`.
 */
export function describeTypes(types: readonly AnalysisType[]): string {
  const names = types.map((type) => type.name);
  if (names.length <= 4) {
    return names.join(' or ');
  }
  return `${names.slice(0, 3).join(', ')} or ${names.length - 3} other types`;
}

/** The expected types for people, as in `a String` or `a Decimal or a Quantity`. */
export function describeExpectation(expected: NonNullable<TypeExpectation['type']>): string {
  if (expected === 'primitive') {
    return 'a primitive value';
  }
  const names = typeof expected === 'string' ? [expected] : expected;
  return names.map(withArticle).join(' or ');
}

/** A type name with its indefinite article: `an Integer`, `a String`. */
export function withArticle(name: string): string {
  return `${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}`;
}
