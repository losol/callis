import type { ElementRow, TypeRow } from '../runtime/provider.ts';

interface TypeReference {
  readonly code: string;
  readonly extension?: readonly { readonly url: string; readonly valueUrl?: string }[];
}
interface SnapshotElement {
  readonly id: string;
  readonly path: string;
  readonly base?: { readonly path: string };
  readonly max?: string;
  readonly contentReference?: string;
  readonly type?: readonly TypeReference[];
}
/** The snapshot fields used by this generator; richer phase-2 metadata is deliberately omitted. */
export interface StructureDefinition {
  readonly resourceType: string;
  readonly url: string;
  readonly type: string;
  readonly kind: string;
  readonly abstract: boolean;
  readonly derivation?: string;
  readonly baseDefinition?: string;
  readonly snapshot?: { readonly element: readonly SnapshotElement[] };
  readonly differential?: { readonly element: readonly { readonly id: string }[] };
}

/**
 * A known error in the `structuredefinition-fhir-type` value of one element of a pinned source,
 * corrected where the element is defined. Elements that inherit it follow the corrected value.
 */
export interface FhirTypeCorrection {
  /** The defining element, for example `Resource.id`. */
  readonly path: string;
  /** The value the pinned source carries. Generation fails when it differs, so an upgrade is reviewed. */
  readonly from: string;
  /** The FHIR type the source's own published definition gives the element. */
  readonly to: string;
}

export interface GenerateOptions {
  readonly corrections?: readonly FhirTypeCorrection[];
}

const SYSTEM_PREFIX = 'http://hl7.org/fhirpath/System.';
const FHIR_TYPE = 'http://hl7.org/fhir/StructureDefinition/structuredefinition-fhir-type';
const SYSTEM_MODEL: ReadonlyMap<string, string> = new Map([
  ['String', 'string'],
  ['Boolean', 'boolean'],
  ['Integer', 'integer'],
  ['Decimal', 'decimal'],
  ['Date', 'date'],
  ['DateTime', 'dateTime'],
  ['Time', 'time'],
]);

type SystemMapping = TypeRow[4];

function systemMapping(name: string, kind: TypeRow[1], value?: SnapshotElement): SystemMapping {
  // https://hl7.org/fhir/R5/fhirpath.html#types; date follows the core contract.
  // integer64's wire value is a string, but its logical FHIRPath type is Long.
  if (name === 'integer64') return 'Long';
  if (name === 'Quantity') return 'Quantity';
  if (kind !== 'primitive') return null;
  const code = value?.type?.[0]?.code;
  switch (code) {
    case `${SYSTEM_PREFIX}String`:
      return 'String';
    case `${SYSTEM_PREFIX}Boolean`:
      return 'Boolean';
    case `${SYSTEM_PREFIX}Integer`:
      return 'Integer';
    case `${SYSTEM_PREFIX}Decimal`:
      return 'Decimal';
    case `${SYSTEM_PREFIX}Date`:
      return 'Date';
    case `${SYSTEM_PREFIX}DateTime`:
      return 'DateTime';
    case `${SYSTEM_PREFIX}Time`:
      return 'Time';
    default:
      throw new Error(`No primitive System mapping for ${name}: ${code}`);
  }
}

/** The model type a System-typed reference names: its FHIR-type extension, else the canonical one. */
function declaredName(type: TypeReference): string {
  const extension = type.extension?.find((entry) => entry.url === FHIR_TYPE)?.valueUrl;
  const name = extension ?? SYSTEM_MODEL.get(type.code.slice(SYSTEM_PREFIX.length));
  if (name === undefined) throw new Error(`No model type for ${type.code}`);
  return name;
}

/** Selects base resource/datatype definitions, excluding profiles and logical models. */
export function coreDefinitions(
  definitions: readonly StructureDefinition[],
): StructureDefinition[] {
  return definitions.filter(
    (definition) =>
      definition.resourceType === 'StructureDefinition' &&
      definition.derivation !== 'constraint' &&
      ['resource', 'complex-type', 'primitive-type'].includes(definition.kind),
  );
}

/** Converts official snapshots into deterministic, validated runtime rows. */
export function generateModel(
  definitions: readonly StructureDefinition[],
  options: GenerateOptions = {},
): readonly TypeRow[] {
  const selected = coreDefinitions(definitions);
  const rows = new Map<string, TypeRow>();
  const roots = new Map(selected.map((definition) => [definition.type, definition]));
  const corrections = new Map((options.corrections ?? []).map((entry) => [entry.path, entry]));
  const applied = new Set<string>();

  /** The element a snapshot element was inherited from: `base.path` names its one defining element. */
  function definingElement(path: string): SnapshotElement {
    const owner = roots.get(path.slice(0, path.indexOf('.')));
    const element = owner?.snapshot?.element.find((candidate) => candidate.path === path);
    if (element === undefined) throw new Error(`Unresolved base element: ${path}`);
    return element;
  }

  /**
   * The FHIR type of a System-typed element, from `structuredefinition-fhir-type` on the element
   * that defines it. A snapshot copy of an inherited element has no say: the publisher fills
   * these extensions inconsistently, so `Patient.id` and `Resource.id` can disagree within one
   * source, and a snapshot element that the differential does not touch is its base, unchanged.
   * https://hl7.org/fhir/R5/elementdefinition-definitions.html#ElementDefinition.base
   * https://hl7.org/fhir/R5/structuredefinition.html#snapshot
   */
  function modelName(
    definition: StructureDefinition,
    element: SnapshotElement,
    type: TypeReference,
  ): string {
    if (!type.code.startsWith(SYSTEM_PREFIX)) return type.code;
    const basePath = element.base?.path;
    const redefined = definition.differential?.element.some((entry) => entry.id === element.id);
    const origin =
      basePath !== undefined && basePath !== element.path && !redefined
        ? definingElement(basePath)
        : element;
    const declared = origin === element ? type : origin.type?.find((t) => t.code === type.code);
    if (declared === undefined) {
      throw new Error(`Base element differs in type: ${element.id}: ${origin.path}`);
    }
    const name = declaredName(declared);
    const correction = corrections.get(origin.path);
    if (correction === undefined) return name;
    if (name !== correction.from) {
      throw new Error(
        `Stale correction: ${origin.path} is ${name}, the correction expects ${correction.from}`,
      );
    }
    applied.add(origin.path);
    return correction.to;
  }
  const primitiveNames = new Set(
    selected
      .filter((definition) => definition.kind === 'primitive-type')
      .map((definition) => definition.type),
  );
  const urls = new Map(selected.map((definition) => [definition.url, definition.type]));
  for (const definition of selected) {
    const snapshot = definition.snapshot?.element;
    if (snapshot === undefined || snapshot.length === 0) {
      throw new Error(`Missing snapshot: ${definition.type}`);
    }
    const byId = new Map(snapshot.map((element) => [element.id, element]));
    const childGroups = new Map<string, SnapshotElement[]>();
    for (const element of snapshot.slice(1)) {
      const parent = element.path.slice(0, element.path.lastIndexOf('.'));
      const group = childGroups.get(parent) ?? [];
      group.push(element);
      childGroups.set(parent, group);
    }
    const inline = new Set([...childGroups.keys()].filter((path) => path !== definition.type));
    function elementTypes(element: SnapshotElement, resolving = new Set<string>()): string[] {
      if (resolving.has(element.id)) throw new Error(`Cyclic contentReference: ${element.id}`);
      if (element.contentReference !== undefined) {
        // https://hl7.org/fhir/R5/elementdefinition-definitions.html#ElementDefinition.contentReference
        const target = byId.get(element.contentReference.slice(1));
        if (!element.contentReference.startsWith('#') || target === undefined) {
          throw new Error(
            `Unresolved contentReference: ${element.id}: ${element.contentReference}`,
          );
        }
        return elementTypes(target, new Set([...resolving, element.id]));
      }
      if (inline.has(element.path)) return [element.path];
      if (element.type === undefined || element.type.length === 0) {
        throw new Error(`No types for ${element.id}`);
      }
      return [...new Set(element.type.map((type) => modelName(definition, element, type)))];
    }
    const kind =
      definition.kind === 'primitive-type'
        ? 'primitive'
        : definition.kind === 'resource'
          ? 'resource'
          : 'complex';
    const base =
      definition.baseDefinition === undefined ? null : urls.get(definition.baseDefinition);
    if (base === undefined) throw new Error(`Unresolved base: ${definition.baseDefinition}`);
    for (const path of [definition.type, ...inline]) {
      const root = path === definition.type;
      const element = byId.get(path);
      const inlineBase = element?.type?.[0]?.code;
      if (!root && inlineBase !== 'Element' && inlineBase !== 'BackboneElement') {
        throw new Error(`Unsupported inline base: ${path}: ${inlineBase}`);
      }
      const children: ElementRow[] = [];
      for (const child of childGroups.get(path) ?? []) {
        const field = child.path.slice(path.length + 1);
        if (root && kind === 'primitive' && field === 'value') continue;
        const choices = field.endsWith('[x]');
        const types = elementTypes(child);
        if (!choices && types.length !== 1) throw new Error(`Non-choice union: ${child.id}`);
        if (child.max === undefined || (child.max !== '*' && !/^\d+$/.test(child.max))) {
          throw new Error(`Invalid cardinality: ${child.id}`);
        }
        children.push([
          choices ? field.slice(0, -3) : field,
          types,
          (child.max === '*' || Number(child.max) > 1 ? 1 : 0) | (choices ? 2 : 0),
        ]);
      }
      if (rows.has(path)) throw new Error(`Duplicate type: ${path}`);
      rows.set(path, [
        path,
        root ? kind : 'backbone',
        root ? base : (inlineBase ?? null),
        root ? definition.abstract : false,
        root && !(kind === 'primitive' && primitiveNames.has(base ?? ''))
          ? systemMapping(path, kind, byId.get(`${path}.value`))
          : null,
        children,
      ]);
    }
  }
  for (const path of corrections.keys()) {
    if (!applied.has(path)) throw new Error(`Unused correction: ${path}`);
  }
  // Snapshot children already include inherited fields and any narrowed cardinalities/types.
  // Validate them rather than re-merging bases and losing snapshot constraints.
  for (const [name, row] of rows) {
    const lineage = new Set([name]);
    let system = row[4];
    for (let base = row[2]; base !== null; ) {
      const ancestor = rows.get(base);
      if (ancestor === undefined) throw new Error(`Unresolved base: ${name}: ${base}`);
      if (lineage.has(base)) throw new Error(`Cyclic inheritance: ${name}`);
      lineage.add(base);
      system ??= ancestor[4];
      base = ancestor[2];
    }
    if (system !== row[4]) rows.set(name, [row[0], row[1], row[2], row[3], system, row[5]]);
    const fields = new Set<string>();
    for (const [field, types] of row[5]) {
      if (fields.has(field)) throw new Error(`Duplicate element: ${name}.${field}`);
      fields.add(field);
      for (const type of types) {
        if (!rows.has(type)) throw new Error(`Unresolved type: ${name}.${field}: ${type}`);
      }
    }
  }
  return [...rows.values()].sort((left, right) =>
    left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0,
  );
}

/** Emits compact tuples, one type per line, without timestamps or machine-specific paths. */
/** The package copy of the provider builder; published source then stays inside the package. */
export function emitProvider(template: string): string {
  return `// Generated by tools/model-gen from tools/model-gen/runtime/provider.ts; do not edit.\n${template}`;
}

export function emitModel(rows: readonly TypeRow[], source: string): string {
  return `// Generated by tools/model-gen; do not edit.\n// Source: ${source} (CC0-1.0); see ../SOURCE.md.\nimport type { TypeRow } from './provider.ts';\n\n/** Compact snapshot data; private to this package. */\n// biome-ignore format: deterministic compact generated rows\nexport const modelData: readonly TypeRow[] = [\n${rows.map((row) => `${JSON.stringify(row)},`).join('\n')}\n];\n`;
}

/** Emits a reviewable inventory of every generated type, grouped by model kind. */
export function emitInventory(rows: readonly TypeRow[], source: string): string {
  const kinds = ['resource', 'complex', 'primitive', 'backbone'] as const;
  const types = Object.fromEntries(
    kinds.map((kind) => [
      kind,
      rows
        .filter((row) => row[1] === kind)
        .map((row) => row[0])
        .sort(),
    ]),
  );
  return `${JSON.stringify({ source, total: rows.length, types }, null, 2)}\n`;
}
