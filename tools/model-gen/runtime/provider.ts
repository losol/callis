import type {
  ElementInfo,
  ModelProvider,
  ModelTypeInfo,
  ModelTypeKind,
  SystemTypeName,
} from '@callis/core';

/** Private wire format: element name, model type names, flags (array=1, choice=2). */
export type ElementRow = readonly [string, readonly string[], number];

/** Private wire format: name, kind, base, abstractness, System mapping, snapshot children. */
export type TypeRow = readonly [
  string,
  ModelTypeKind,
  string | null,
  boolean,
  Exclude<SystemTypeName, 'Any'> | null,
  readonly ElementRow[],
];

/** Builds private indexes once; no mutable data escapes into evaluations. */
export function createProvider(version: string, rows: readonly TypeRow[]): ModelProvider {
  const types = new Map<string, ModelTypeInfo>();
  const elements = new Map<string, readonly ElementInfo[]>();
  const elementIndexes = new Map<string, ReadonlyMap<string, ElementInfo>>();
  const ancestors = new Map<string, ReadonlySet<string>>();
  const systems = new Map<string, Exclude<SystemTypeName, 'Any'>>();
  const empty: readonly ElementInfo[] = Object.freeze([]);
  for (const [name, kind, base, isAbstract, system, children] of rows) {
    types.set(
      name,
      Object.freeze({
        namespace: 'FHIR',
        name,
        kind,
        isAbstract,
        ...(base === null ? {} : { baseName: base }),
      }),
    );
    const fields = Object.freeze(
      children.map(
        ([field, typeNames, flags]): ElementInfo =>
          Object.freeze({
            name: field,
            typeNames: Object.freeze([...typeNames]),
            isArray: (flags & 1) !== 0,
            isChoice: (flags & 2) !== 0,
          }),
      ),
    );
    elements.set(name, fields);
    elementIndexes.set(name, new Map(fields.map((field) => [field.name, field])));
    if (system !== null) systems.set(name, system);
  }
  for (const type of types.values()) {
    const lineage = new Set<string>([type.name]);
    for (let base = type.baseName; base !== undefined; base = types.get(base)?.baseName) {
      lineage.add(base);
    }
    ancestors.set(type.name, lineage);
  }
  return Object.freeze({
    namespace: 'FHIR',
    version,
    getType: (name: string): ModelTypeInfo | undefined => types.get(name),
    getRootType(json: object): ModelTypeInfo | undefined {
      if (
        !Object.hasOwn(json, 'resourceType') ||
        !('resourceType' in json) ||
        typeof json.resourceType !== 'string'
      )
        return undefined;
      const type = types.get(json.resourceType);
      return type?.kind === 'resource' && !type.isAbstract ? type : undefined;
    },
    getElements: (type: ModelTypeInfo): readonly ElementInfo[] => elements.get(type.name) ?? empty,
    getElement: (type: ModelTypeInfo, name: string): ElementInfo | undefined =>
      elementIndexes.get(type.name)?.get(name),
    isSubtypeOf: (type: ModelTypeInfo, ancestor: ModelTypeInfo): boolean =>
      ancestors.get(type.name)?.has(ancestor.name) ?? false,
    getSystemType: (type: ModelTypeInfo): Exclude<SystemTypeName, 'Any'> | undefined =>
      systems.get(type.name),
  });
}
