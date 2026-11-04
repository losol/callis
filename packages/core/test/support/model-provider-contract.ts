/**
 * A reusable test suite for the `ModelProvider` contract (`src/model/model-provider.ts`).
 *
 * Every provider runs it: the stub model here, and the generated R4 and R5 models (T0019). It
 * checks the rules the TSDoc states, over every type reachable from a few start types through
 * base types and element types, so it needs no list of all types.
 */
import { describe, expect, it } from 'vitest';
import {
  choiceJsonName,
  type ElementInfo,
  type ModelProvider,
  type ModelTypeInfo,
  type ModelTypeKind,
} from '../../src/model/model-provider.ts';
import type { SystemTypeName } from '../../src/types/system-types.ts';

/** What the contract suite needs to know about a provider's data. */
export interface ModelProviderFixtures {
  /** Type names to start from. Every type reachable from them is checked. */
  readonly startTypes: readonly string[];
  /** A concrete resource type, for `getRootType()`. */
  readonly resourceType: string;
  /** A type that is not a resource, which `getRootType()` must not return. */
  readonly nonResourceType: string;
  /** Expected `getSystemType()` results; `undefined` for a type that does not convert. */
  readonly systemTypes: ReadonlyArray<
    readonly [typeName: string, systemType: Exclude<SystemTypeName, 'Any'> | undefined]
  >;
  /** Choice elements and the types they allow. */
  readonly choiceElements: ReadonlyArray<{
    readonly type: string;
    readonly element: string;
    readonly typeNames: readonly string[];
  }>;
}

const KINDS: readonly ModelTypeKind[] = ['primitive', 'complex', 'resource', 'backbone'];
const PROTOTYPE_NAMES = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];

interface Reachable {
  readonly types: readonly ModelTypeInfo[];
  /** Base type and element type names that `getType()` does not resolve, with where they occur. */
  readonly unresolved: readonly string[];
}

/** Every type reachable from the start types through base types and element types. */
function collectReachable(provider: ModelProvider, startTypes: readonly string[]): Reachable {
  const types = new Map<string, ModelTypeInfo>();
  const unresolved: string[] = [];
  const queue: Array<readonly [name: string, from: string]> = startTypes.map((name) => [
    name,
    'start types',
  ]);
  for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
    const [name, from] = entry;
    if (types.has(name)) {
      continue;
    }
    const type = provider.getType(name);
    if (type === undefined) {
      unresolved.push(`${name} (from ${from})`);
      continue;
    }
    types.set(name, type);
    if (type.baseName !== undefined) {
      queue.push([type.baseName, `base of ${name}`]);
    }
    for (const element of provider.getElements(type)) {
      for (const typeName of element.typeNames) {
        queue.push([typeName, `${name}.${element.name}`]);
      }
    }
  }
  return { types: [...types.values()], unresolved };
}

function names(elements: readonly ElementInfo[]): string[] {
  return elements.map((element) => element.name);
}

function typeNamed(provider: ModelProvider, name: string): ModelTypeInfo {
  const type = provider.getType(name);
  if (type === undefined) {
    throw new Error(`The provider has no type ${name}`);
  }
  return type;
}

/** The base types of a type, nearest first. */
function ancestors(provider: ModelProvider, type: ModelTypeInfo): ModelTypeInfo[] {
  const result: ModelTypeInfo[] = [];
  for (let base = type.baseName; base !== undefined; ) {
    const baseType = typeNamed(provider, base);
    result.push(baseType);
    base = baseType.baseName;
  }
  return result;
}

/**
 * Registers the contract tests for a provider.
 *
 * @example
 * ```ts
 * describeModelProviderContract(r4, { startTypes: ['Patient', 'Observation'], … });
 * ```
 */
export function describeModelProviderContract(
  provider: ModelProvider,
  fixtures: ModelProviderFixtures,
): void {
  const reachable = (): Reachable => collectReachable(provider, fixtures.startTypes);

  describe(`ModelProvider contract (${provider.namespace} ${provider.version})`, () => {
    it('uses a namespace other than System', () => {
      expect(provider.namespace).not.toBe('System');
      expect(provider.namespace).not.toBe('');
    });

    it('resolves every start type, base type and element type name', () => {
      expect(reachable().unresolved).toEqual([]);
    });

    it('returns well-formed types, the same object for the same name', () => {
      for (const type of reachable().types) {
        expect(type.namespace, type.name).toBe(provider.namespace);
        expect(KINDS, type.name).toContain(type.kind);
        expect(typeof type.isAbstract, type.name).toBe('boolean');
        expect(provider.getType(type.name), type.name).toBe(type);
      }
    });

    it('lists inherited elements first, in the order of the base type', () => {
      for (const type of reachable().types) {
        const [base] = ancestors(provider, type);
        if (base !== undefined) {
          const inherited = names(provider.getElements(base));
          const all = names(provider.getElements(type));
          expect(all.slice(0, inherited.length), type.name).toEqual(inherited);
        }
      }
    });

    it('does not list the implicit value of a primitive type', () => {
      for (const type of reachable().types) {
        if (type.kind === 'primitive') {
          expect(names(provider.getElements(type)), type.name).not.toContain('value');
        }
      }
    });

    it('finds every listed element by name, as the same object', () => {
      for (const type of reachable().types) {
        const elements = provider.getElements(type);
        expect(new Set(names(elements)).size, type.name).toBe(elements.length);
        for (const element of elements) {
          expect(provider.getElement(type, element.name), `${type.name}.${element.name}`).toBe(
            element,
          );
          expect(element.typeNames.length, `${type.name}.${element.name}`).toBeGreaterThan(0);
          if (!element.isChoice) {
            expect(element.typeNames, `${type.name}.${element.name}`).toHaveLength(1);
          }
        }
      }
    });

    it('finds choice elements by their name without [x], not by a JSON key', () => {
      for (const { type: typeName, element: name, typeNames } of fixtures.choiceElements) {
        const type = typeNamed(provider, typeName);
        const element = provider.getElement(type, name);
        expect(element, `${typeName}.${name}`).toMatchObject({ isChoice: true, typeNames });
        for (const choiceType of typeNames) {
          expect(provider.getElement(type, choiceJsonName(name, choiceType))).toBeUndefined();
        }
      }
    });

    it('treats isSubtypeOf as reflexive and follows base types', () => {
      for (const type of reachable().types) {
        expect(provider.isSubtypeOf(type, type), type.name).toBe(true);
        for (const ancestor of ancestors(provider, type)) {
          expect(provider.isSubtypeOf(type, ancestor), `${type.name} < ${ancestor.name}`).toBe(
            true,
          );
          expect(provider.isSubtypeOf(ancestor, type), `${ancestor.name} < ${type.name}`).toBe(
            false,
          );
        }
      }
    });

    it('maps model types to System types, never to Any', () => {
      for (const [typeName, expected] of fixtures.systemTypes) {
        expect(provider.getSystemType(typeNamed(provider, typeName)), typeName).toBe(expected);
      }
      for (const type of reachable().types) {
        expect(provider.getSystemType(type), type.name).not.toBe('Any');
      }
    });

    it('treats a copy of a type like the type itself', () => {
      for (const type of reachable().types) {
        const copy: ModelTypeInfo = { ...type };
        const elements = provider.getElements(type);
        const copied = provider.getElements(copy);
        expect(copied.length, type.name).toBe(elements.length);
        elements.forEach((element, index) => {
          expect(copied[index], `${type.name}.${element.name}`).toBe(element);
          expect(provider.getElement(copy, element.name), `${type.name}.${element.name}`).toBe(
            element,
          );
        });
        expect(provider.getSystemType(copy), type.name).toBe(provider.getSystemType(type));
        expect(provider.isSubtypeOf(copy, { ...type }), type.name).toBe(true);
        for (const ancestor of ancestors(provider, type)) {
          expect(provider.isSubtypeOf(copy, { ...ancestor }), type.name).toBe(true);
        }
      }
    });

    it('does not reach Object.prototype members', () => {
      const resource = typeNamed(provider, fixtures.resourceType);
      for (const name of PROTOTYPE_NAMES) {
        expect(provider.getType(name), name).toBeUndefined();
        expect(provider.getElement(resource, name), name).toBeUndefined();
      }
    });

    it('takes the root type from an own resourceType property only', () => {
      const resourceType = fixtures.resourceType;
      const inherited: object = Object.create({ resourceType });
      expect(provider.getRootType({ resourceType })).toBe(typeNamed(provider, resourceType));
      expect(provider.getRootType(inherited)).toBeUndefined();
      expect(provider.getRootType({ resourceType: fixtures.nonResourceType })).toBeUndefined();
      expect(provider.getRootType({ resourceType: 42 })).toBeUndefined();
      expect(provider.getRootType({ resourceType: 'constructor' })).toBeUndefined();
      expect(provider.getRootType({})).toBeUndefined();
    });
  });
}
