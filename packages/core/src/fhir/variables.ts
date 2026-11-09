/**
 * The FHIR environment variables: `%resource` and `%rootResource`
 * ([R5 §2.1.9.1.4](https://hl7.org/fhir/R5/fhirpath.html#variables)), and `%sct`, `%loinc`,
 * `` %`vs-[name]` `` and `` %`ext-[name]` ``
 * ([R5 §2.1.9.1.7](https://hl7.org/fhir/R5/fhirpath.html#vars)). R4
 * ([§2.9.1](https://hl7.org/fhir/R4/fhirpath.html#variables)) and the R6 draft
 * ([§2.1.9.2](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#variables)) define them the same
 * way, so there is no version-specific code.
 *
 * `%resource` and `%rootResource` follow the parent chain of the input nodes
 * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#resource-and-rootresource)):
 * a node knows the node it was navigated from, so an input node selected by an earlier evaluation
 * still belongs to its resource.
 */
import { ModelNode } from '../model/model-node.ts';
import type { ModelProvider } from '../model/model-provider.ts';
import { type Collection, EMPTY, type Item } from '../runtime/collection.ts';
import type { EnvironmentLookup } from '../runtime/context.ts';
import { resourceTypeOf, toInputCollection } from '../runtime/navigation.ts';

/** The value of `%sct`: SNOMED CT. */
export const SNOMED_CT_URL = 'http://snomed.info/sct';
/** The value of `%loinc`: LOINC. */
export const LOINC_URL = 'http://loinc.org';
/** What `` %`vs-[name]` `` prefixes to the name: the canonical URL of an HL7 value set. */
export const VALUE_SET_URL_PREFIX = 'http://hl7.org/fhir/ValueSet/';
/** What `` %`ext-[name]` `` prefixes to the name: the canonical URL of an HL7 extension. */
export const EXTENSION_URL_PREFIX = 'http://hl7.org/fhir/StructureDefinition/';

const SNOMED_CT: Collection = Object.freeze([SNOMED_CT_URL]);
const LOINC: Collection = Object.freeze([LOINC_URL]);

/**
 * The value of one of the FHIR URL constants, by name without the `%`: `sct`, `loinc`,
 * `vs-[name]` or `ext-[name]` ([R5 §2.1.9.1.7](https://hl7.org/fhir/R5/fhirpath.html#vars)).
 * Undefined for any other name, including `vs-` and `ext-` without a name.
 *
 * @example
 * ```ts
 * fhirConstant('vs-administrative-gender'); // ['http://hl7.org/fhir/ValueSet/administrative-gender']
 * ```
 */
export function fhirConstant(name: string): Collection | undefined {
  if (name === 'sct') {
    return SNOMED_CT;
  }
  if (name === 'loinc') {
    return LOINC;
  }
  if (name.startsWith('vs-') && name.length > 3) {
    return [VALUE_SET_URL_PREFIX + name.slice(3)];
  }
  if (name.startsWith('ext-') && name.length > 4) {
    return [EXTENSION_URL_PREFIX + name.slice(4)];
  }
  return undefined;
}

/** Whether an item is an input node that holds a resource: an object with a `resourceType`. */
export function isResourceNode(item: Item): item is ModelNode {
  return item instanceof ModelNode && resourceTypeOf(item.value) !== undefined;
}

/**
 * The resource a node is part of: the node itself when it holds a resource, otherwise its nearest
 * ancestor that does. Undefined when there is none, as for a data type passed on its own.
 */
export function enclosingResource(node: ModelNode): ModelNode | undefined {
  for (let current: ModelNode | undefined = node; current !== undefined; current = current.parent) {
    if (resourceTypeOf(current.value) !== undefined) {
      return current;
    }
  }
  return undefined;
}

/**
 * The resource that contains a contained resource, or the resource itself when it is not
 * contained ([R5 §2.1.9.1.4](https://hl7.org/fhir/R5/fhirpath.html#variables)). A contained
 * resource is a node reached through the `contained` element of a resource. FHIR does not allow a
 * contained resource to contain others; should the data nest them anyway, this is the outermost
 * container. A resource in a `Bundle` entry is not contained, so the walk never enters the Bundle.
 */
export function containerOf(resource: ModelNode): ModelNode {
  let current = resource;
  for (
    let parent = current.parent;
    current.name === 'contained' && parent !== undefined && isResourceNode(parent);
    parent = current.parent
  ) {
    current = parent;
  }
  return current;
}

/**
 * The default `%resource` for a `%context`: for each input node, the resource it is part of
 * ({@link enclosingResource}), or the node itself when it is part of none; any other item is used
 * as it is. A resource reached from several items is listed once.
 */
export function resourceOf(context: Collection): Collection {
  return mapUnique(context, (item) =>
    item instanceof ModelNode ? (enclosingResource(item) ?? item) : item,
  );
}

/**
 * The default `%rootResource` for a `%resource`: the container of each contained resource
 * ({@link containerOf}), and every other item as it is.
 */
export function rootResourceOf(resource: Collection): Collection {
  return mapUnique(resource, (item) => (isResourceNode(item) ? containerOf(item) : item));
}

/**
 * Maps every item, keeping the first of several nodes that hold the same JSON object, so a
 * resource reached through several of its elements is one item.
 */
function mapUnique(items: Collection, map: (item: Item) => Item): Collection {
  if (items.length === 0) {
    return EMPTY;
  }
  const result: Item[] = [];
  for (const item of items) {
    const mapped = map(item);
    if (!result.some((seen) => isSameNode(seen, mapped))) {
      result.push(mapped);
    }
  }
  return result;
}

function isSameNode(a: Item, b: Item): boolean {
  if (a === b) {
    return a instanceof ModelNode;
  }
  return (
    a instanceof ModelNode &&
    b instanceof ModelNode &&
    typeof a.value === 'object' &&
    a.value !== null &&
    a.value === b.value
  );
}

/** The host's values for `%resource` and `%rootResource`, if it overrides them. */
export interface ResourceOverrides {
  /** Overrides `%resource`; undefined keeps the default. */
  readonly resource?: unknown;
  /** Overrides `%rootResource`; undefined keeps the default. */
  readonly rootResource?: unknown;
}

/**
 * The FHIR environment of one evaluation: `%resource`, `%rootResource` and the URL constants
 * ({@link fhirConstant}), for `EvalContext.environment`. A host variable of the same name hides
 * them (`lookUpVariable()`).
 *
 * `%resource` defaults to {@link resourceOf} the `%context`, and `%rootResource` to
 * {@link rootResourceOf} the `%resource`, whether that is the default or the host's value. Both are
 * computed on first use and kept for the evaluation. A host value is converted like a variable
 * value, typed by the model: a JSON value, a node, a value class or an array, where `null` and
 * `[]` make the variable empty.
 *
 * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` when a host value is not JSON
 *   data, as for variables.
 */
export function createFhirEnvironment(
  context: Collection,
  overrides: ResourceOverrides,
  model: ModelProvider | undefined,
): EnvironmentLookup {
  // Converted now, so an invalid value fails the evaluation even when no expression reads it.
  let resource =
    overrides.resource === undefined
      ? undefined
      : toInputCollection(overrides.resource, 'resource', model);
  let rootResource =
    overrides.rootResource === undefined
      ? undefined
      : toInputCollection(overrides.rootResource, 'rootResource', model);
  const currentResource = (): Collection => {
    resource ??= resourceOf(context);
    return resource;
  };
  return (name) => {
    if (name === 'resource') {
      return currentResource();
    }
    if (name === 'rootResource') {
      rootResource ??= rootResourceOf(currentResource());
      return rootResource;
    }
    return fhirConstant(name);
  };
}
