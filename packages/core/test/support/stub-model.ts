/**
 * A tiny FHIR-like model for tests: a handful of resources, data types and primitives with the
 * same names, inheritance and System mappings as FHIR R4. It implements the whole
 * `ModelProvider` contract, so tests can use it until the generated models exist (T0019).
 */
import type {
  ElementInfo,
  ModelProvider,
  ModelTypeInfo,
  ModelTypeKind,
} from '../../src/model/model-provider.ts';
import type { SystemTypeName } from '../../src/types/system-types.ts';

interface TypeDefinition {
  readonly kind: ModelTypeKind;
  readonly base?: string;
  readonly isAbstract?: boolean;
  readonly systemType?: SystemTypeName;
  readonly elements?: readonly ElementInfo[];
}

function element(
  name: string,
  typeNames: readonly string[],
  options: { readonly isArray?: boolean; readonly isChoice?: boolean } = {},
): ElementInfo {
  return {
    name,
    typeNames,
    isArray: options.isArray ?? false,
    isChoice: options.isChoice ?? false,
  };
}

const DEFINITIONS: ReadonlyArray<readonly [string, TypeDefinition]> = [
  [
    'Element',
    {
      kind: 'complex',
      elements: [element('id', ['string']), element('extension', ['Extension'], { isArray: true })],
    },
  ],
  [
    'BackboneElement',
    {
      kind: 'complex',
      base: 'Element',
      isAbstract: true,
      elements: [element('modifierExtension', ['Extension'], { isArray: true })],
    },
  ],
  [
    'Extension',
    {
      kind: 'complex',
      base: 'Element',
      elements: [
        element('url', ['uri']),
        element('value', ['string', 'boolean', 'Quantity'], { isChoice: true }),
      ],
    },
  ],
  ['boolean', { kind: 'primitive', base: 'Element', systemType: 'Boolean' }],
  ['string', { kind: 'primitive', base: 'Element', systemType: 'String' }],
  ['code', { kind: 'primitive', base: 'string', systemType: 'String' }],
  ['id', { kind: 'primitive', base: 'string', systemType: 'String' }],
  ['uri', { kind: 'primitive', base: 'Element', systemType: 'String' }],
  ['integer', { kind: 'primitive', base: 'Element', systemType: 'Integer' }],
  ['decimal', { kind: 'primitive', base: 'Element', systemType: 'Decimal' }],
  ['date', { kind: 'primitive', base: 'Element', systemType: 'Date' }],
  ['dateTime', { kind: 'primitive', base: 'Element', systemType: 'DateTime' }],
  [
    'Quantity',
    {
      kind: 'complex',
      base: 'Element',
      systemType: 'Quantity',
      elements: [
        element('value', ['decimal']),
        element('unit', ['string']),
        element('system', ['uri']),
        element('code', ['code']),
      ],
    },
  ],
  ['Age', { kind: 'complex', base: 'Quantity', systemType: 'Quantity' }],
  [
    'HumanName',
    {
      kind: 'complex',
      base: 'Element',
      elements: [
        element('use', ['code']),
        element('family', ['string']),
        element('given', ['string'], { isArray: true }),
      ],
    },
  ],
  ['Resource', { kind: 'resource', isAbstract: true, elements: [element('id', ['id'])] }],
  [
    'DomainResource',
    {
      kind: 'resource',
      base: 'Resource',
      isAbstract: true,
      elements: [
        element('contained', ['Resource'], { isArray: true }),
        element('extension', ['Extension'], { isArray: true }),
      ],
    },
  ],
  [
    'Patient',
    {
      kind: 'resource',
      base: 'DomainResource',
      elements: [
        element('active', ['boolean']),
        element('name', ['HumanName'], { isArray: true }),
        element('birthDate', ['date']),
        element('contact', ['Patient.contact'], { isArray: true }),
      ],
    },
  ],
  [
    'Patient.contact',
    { kind: 'backbone', base: 'BackboneElement', elements: [element('name', ['HumanName'])] },
  ],
  [
    'Observation',
    {
      kind: 'resource',
      base: 'DomainResource',
      elements: [
        element('status', ['code']),
        element('value', ['Quantity', 'string', 'boolean'], { isChoice: true }),
      ],
    },
  ],
];

const NAMESPACE = 'FHIR';

const types = new Map<string, ModelTypeInfo>();
const systemTypes = new Map<ModelTypeInfo, SystemTypeName>();
for (const [name, definition] of DEFINITIONS) {
  const type: ModelTypeInfo = Object.freeze({
    namespace: NAMESPACE,
    name,
    kind: definition.kind,
    ...(definition.base === undefined ? {} : { baseName: definition.base }),
    isAbstract: definition.isAbstract ?? false,
  });
  types.set(name, type);
  if (definition.systemType !== undefined) {
    systemTypes.set(type, definition.systemType);
  }
}

/** All elements of each type, inherited ones first, as a snapshot lists them. */
const elementLists = new Map<ModelTypeInfo, readonly ElementInfo[]>();
const elementMaps = new Map<ModelTypeInfo, ReadonlyMap<string, ElementInfo>>();
for (const type of types.values()) {
  const all = Object.freeze(collectElements(type));
  elementLists.set(type, all);
  elementMaps.set(type, new Map(all.map((info) => [info.name, info])));
}

function lookUp(name: string): ModelTypeInfo {
  const type = types.get(name);
  if (type === undefined) {
    throw new Error(`Stub model has no type ${name}`);
  }
  return type;
}

function collectElements(type: ModelTypeInfo): readonly ElementInfo[] {
  const definition = DEFINITIONS.find(([name]) => name === type.name)?.[1];
  const base = type.baseName === undefined ? undefined : lookUp(type.baseName);
  const inherited = base === undefined ? [] : collectElements(base);
  return [...inherited, ...(definition?.elements ?? [])];
}

/** A FHIR-like {@link ModelProvider} for tests. */
export const stubModel: ModelProvider = Object.freeze({
  namespace: NAMESPACE,
  version: '0.0.0-stub',
  getType(name: string): ModelTypeInfo | undefined {
    return types.get(name);
  },
  getRootType(json: object): ModelTypeInfo | undefined {
    if (!Object.hasOwn(json, 'resourceType')) {
      return undefined;
    }
    const resourceType: unknown = Reflect.get(json, 'resourceType');
    const type = typeof resourceType === 'string' ? types.get(resourceType) : undefined;
    return type?.kind === 'resource' ? type : undefined;
  },
  getElement(type: ModelTypeInfo, name: string): ElementInfo | undefined {
    return elementMaps.get(type)?.get(name);
  },
  getElements(type: ModelTypeInfo): readonly ElementInfo[] {
    return elementLists.get(type) ?? [];
  },
  isSubtypeOf(type: ModelTypeInfo, ancestor: ModelTypeInfo): boolean {
    for (let current: ModelTypeInfo | undefined = type; current !== undefined; ) {
      if (current === ancestor) {
        return true;
      }
      current = current.baseName === undefined ? undefined : types.get(current.baseName);
    }
    return false;
  },
  getSystemType(type: ModelTypeInfo): SystemTypeName | undefined {
    return systemTypes.get(type);
  },
});

/** A type of the stub model by name; throws if there is none, to keep tests short. */
export function stubType(name: string): ModelTypeInfo {
  return lookUp(name);
}
