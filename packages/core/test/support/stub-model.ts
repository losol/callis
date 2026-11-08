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
  readonly systemType?: Exclude<SystemTypeName, 'Any'>;
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
        element(
          'value',
          [
            'string',
            'boolean',
            'Quantity',
            'Age',
            'Duration',
            'dateTime',
            'integer',
            'decimal',
            'code',
            'Period',
          ],
          { isChoice: true },
        ),
      ],
    },
  ],
  ['boolean', { kind: 'primitive', base: 'Element', systemType: 'Boolean' }],
  ['string', { kind: 'primitive', base: 'Element', systemType: 'String' }],
  ['code', { kind: 'primitive', base: 'string', systemType: 'String' }],
  ['id', { kind: 'primitive', base: 'string', systemType: 'String' }],
  ['uri', { kind: 'primitive', base: 'Element', systemType: 'String' }],
  ['url', { kind: 'primitive', base: 'uri', systemType: 'String' }],
  ['integer', { kind: 'primitive', base: 'Element', systemType: 'Integer' }],
  ['positiveInt', { kind: 'primitive', base: 'integer', systemType: 'Integer' }],
  ['integer64', { kind: 'primitive', base: 'Element', systemType: 'Long' }],
  ['decimal', { kind: 'primitive', base: 'Element', systemType: 'Decimal' }],
  ['date', { kind: 'primitive', base: 'Element', systemType: 'Date' }],
  ['dateTime', { kind: 'primitive', base: 'Element', systemType: 'DateTime' }],
  ['instant', { kind: 'primitive', base: 'Element', systemType: 'DateTime' }],
  ['time', { kind: 'primitive', base: 'Element', systemType: 'Time' }],
  [
    'Period',
    {
      kind: 'complex',
      base: 'Element',
      elements: [element('start', ['dateTime']), element('end', ['dateTime'])],
    },
  ],
  [
    'Coding',
    {
      kind: 'complex',
      base: 'Element',
      elements: [
        element('system', ['uri']),
        element('code', ['code']),
        element('display', ['string']),
      ],
    },
  ],
  [
    'CodeableConcept',
    {
      kind: 'complex',
      base: 'Element',
      elements: [element('coding', ['Coding'], { isArray: true }), element('text', ['string'])],
    },
  ],
  [
    'ContactPoint',
    {
      kind: 'complex',
      base: 'Element',
      elements: [
        element('system', ['code']),
        element('value', ['string']),
        element('use', ['code']),
        element('rank', ['positiveInt']),
      ],
    },
  ],
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
  ['Duration', { kind: 'complex', base: 'Quantity', systemType: 'Quantity' }],
  [
    'HumanName',
    {
      kind: 'complex',
      base: 'Element',
      elements: [
        element('use', ['code']),
        element('text', ['string']),
        element('family', ['string']),
        element('given', ['string'], { isArray: true }),
        element('prefix', ['string'], { isArray: true }),
        element('suffix', ['string'], { isArray: true }),
        element('period', ['Period']),
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
        element('telecom', ['ContactPoint'], { isArray: true }),
        element('gender', ['code']),
        element('birthDate', ['date']),
        element('deceased', ['boolean', 'dateTime'], { isChoice: true }),
        element('multipleBirth', ['boolean', 'integer'], { isChoice: true }),
        element('contact', ['Patient.contact'], { isArray: true }),
      ],
    },
  ],
  [
    'Patient.contact',
    {
      kind: 'backbone',
      base: 'BackboneElement',
      elements: [
        element('relationship', ['CodeableConcept'], { isArray: true }),
        element('name', ['HumanName']),
        element('period', ['Period']),
      ],
    },
  ],
  [
    'Observation',
    {
      kind: 'resource',
      base: 'DomainResource',
      elements: [
        element('status', ['code']),
        element('code', ['CodeableConcept']),
        element('effective', ['dateTime', 'Period'], { isChoice: true }),
        element('issued', ['instant']),
        element(
          'value',
          ['Quantity', 'string', 'boolean', 'dateTime', 'Period', 'integer', 'CodeableConcept'],
          { isChoice: true },
        ),
      ],
    },
  ],
  [
    'Bundle',
    {
      kind: 'resource',
      base: 'Resource',
      elements: [element('type', ['code']), element('entry', ['Bundle.entry'], { isArray: true })],
    },
  ],
  [
    'Bundle.entry',
    {
      kind: 'backbone',
      base: 'BackboneElement',
      elements: [element('fullUrl', ['uri']), element('resource', ['Resource'])],
    },
  ],
];

const NAMESPACE = 'FHIR';

const types = new Map<string, ModelTypeInfo>();
const systemTypes = new Map<string, Exclude<SystemTypeName, 'Any'>>();
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
    systemTypes.set(name, definition.systemType);
  }
}

/** All elements of each type by type name, inherited ones first, as a snapshot lists them. */
const elementLists = new Map<string, readonly ElementInfo[]>();
const elementMaps = new Map<string, ReadonlyMap<string, ElementInfo>>();
for (const type of types.values()) {
  const all = Object.freeze(collectElements(type));
  elementLists.set(type.name, all);
  elementMaps.set(type.name, new Map(all.map((info) => [info.name, info])));
}

function lookUp(name: string): ModelTypeInfo {
  const type = types.get(name);
  if (type === undefined) {
    throw new Error(`Stub model has no type ${name}`);
  }
  return type;
}

function collectElements(type: ModelTypeInfo): ElementInfo[] {
  const definition = DEFINITIONS.find(([name]) => name === type.name)?.[1];
  const base = type.baseName === undefined ? undefined : lookUp(type.baseName);
  const inherited = base === undefined ? [] : collectElements(base);
  return [...inherited, ...(definition?.elements ?? [])];
}

/**
 * A FHIR-like {@link ModelProvider} for tests. Like a real provider, it identifies a type passed
 * to its methods by name, so copies of type objects work.
 */
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
    return elementMaps.get(type.name)?.get(name);
  },
  getElements(type: ModelTypeInfo): readonly ElementInfo[] {
    return elementLists.get(type.name) ?? [];
  },
  isSubtypeOf(type: ModelTypeInfo, ancestor: ModelTypeInfo): boolean {
    for (let name: string | undefined = type.name; name !== undefined; ) {
      if (name === ancestor.name) {
        return true;
      }
      name = types.get(name)?.baseName;
    }
    return false;
  },
  getSystemType(type: ModelTypeInfo): Exclude<SystemTypeName, 'Any'> | undefined {
    return systemTypes.get(type.name);
  },
});

/** A type of the stub model by name; throws if there is none, to keep tests short. */
export function stubType(name: string): ModelTypeInfo {
  return lookUp(name);
}
