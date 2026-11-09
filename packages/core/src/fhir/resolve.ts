/**
 * `resolve()` for references that point into the data being evaluated
 * ([R5 §2.1.9.1.5](https://hl7.org/fhir/R5/fhirpath.html#functions),
 * [spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#local-references-in-resolve)):
 * contained resources (`#id`) and the entries of the `Bundle` around the reference, matched on
 * `fullUrl` with relative references made absolute
 * ([FHIR Bundle references](https://hl7.org/fhir/R5/bundle.html#references)).
 * A host hook for other references comes with [T0021](https://github.com/losol/callis/blob/main/docs/tasks/T0021-hooks-async.md#host-hooks).
 *
 * A resolved resource is the node that navigation gives for it, typed the same way and with the
 * same parent chain, so `'#p1'.resolve()` and `contained.where(id = 'p1')` give the same node.
 */
import { defineValueFunction, type FunctionDefinition } from '../functions/define.ts';
import { JsonNumber } from '../model/lossless-json.ts';
import { ModelNode } from '../model/model-node.ts';
import type { ModelProvider } from '../model/model-provider.ts';
import { type Collection, EMPTY, type Item } from '../runtime/collection.ts';
import type { EvalContext } from '../runtime/context.ts';
import { navigateMember, resourceTypeOf } from '../runtime/navigation.ts';
import { toSystemValue } from '../runtime/node-value.ts';
import { lookUpVariable } from '../runtime/variables.ts';
import { containerOf, enclosingResource } from './variables.ts';

type JsonObject = Readonly<Record<string, unknown>>;

/**
 * `resolve()`: for each input item that is a reference, the resource it points to, in input
 * order. An item that does not resolve adds nothing; empty input gives empty, and nothing raises
 * an error.
 *
 * - A String, or a FHIR primitive such as `uri`, `url` or `canonical`, is the reference itself.
 * - A `Reference` (without a model, any object with a string `reference`) gives its `reference`.
 * - `#id` is the resource with that `id` among the `contained` resources of the reference's own
 *   root resource, the container of the resource the item is part of; `#` alone is that root
 *   resource. Each resource of an input with several resources keeps its own. `%rootResource` is
 *   used for an item that is part of no resource, such as a String literal, and for one in
 *   `%resource` when the host's `%rootResource` does not hold its container: a contained resource
 *   evaluated on its own, with its container as the `rootResource` option.
 * - Any other reference is looked up in the nearest `Bundle` around the item, or for an item that
 *   is part of no resource, around each item of `%rootResource` in turn, as
 *   [Bundle references](https://hl7.org/fhir/R5/bundle.html#references) describe: an absolute
 *   reference or URN matches the entry `fullUrl`, and a relative `Type/id` is first made absolute
 *   with the RESTful base of the `fullUrl` of the entry it is in. A version (`/_history/1`) is
 *   removed and must match `meta.versionId`. Where the entry has no RESTful base, as with a
 *   `urn:uuid:` `fullUrl`, the spec leaves `Type/id` undefined, and Callis matches the resource
 *   type and id instead. The first matching entry wins.
 *
 * @see https://hl7.org/fhir/R5/fhirpath.html#functions
 */
export const resolveFunction: FunctionDefinition = defineValueFunction(
  'resolve',
  0,
  (input, _args, call) => {
    const items: Item[] = [];
    for (const item of input) {
      const reference = referenceOf(item, call.ctx.model);
      const target = reference === undefined ? undefined : resolveLocal(reference, item, call.ctx);
      if (target !== undefined) {
        items.push(target);
      }
    }
    return items.length === 0 ? EMPTY : items;
  },
);

/** The reference text an item stands for, if it is a reference at all. */
function referenceOf(item: Item, model: ModelProvider | undefined): string | undefined {
  const value = toSystemValue(item);
  if (typeof value === 'string') {
    return value;
  }
  if (!(item instanceof ModelNode) || !isJsonObject(item.value)) {
    return undefined;
  }
  if (model !== undefined && item.type !== undefined) {
    const reference = model.getType('Reference');
    if (reference === undefined || !model.isSubtypeOf(item.type, reference)) {
      return undefined;
    }
  }
  return ownString(item.value, 'reference');
}

function resolveLocal(reference: string, item: Item, ctx: EvalContext): ModelNode | undefined {
  if (reference.startsWith('#')) {
    return resolveContained(reference.slice(1), item, ctx);
  }
  const target = parseReference(reference);
  const searched: ModelNode[] = [];
  for (const anchor of anchorsOf(item, ctx)) {
    const bundle = enclosingBundle(anchor);
    if (bundle === undefined || searched.includes(bundle)) {
      continue;
    }
    const found = findInBundle(bundle, target, entryOf(anchor, bundle), ctx);
    if (found !== undefined) {
      return found;
    }
    searched.push(bundle);
  }
  return undefined;
}

/**
 * The contained resource `id` of the root resource that the reference belongs to, or that root
 * resource itself for an empty `id`.
 */
function resolveContained(id: string, item: Item, ctx: EvalContext): ModelNode | undefined {
  for (const root of rootsFor(item, ctx)) {
    if (!(root instanceof ModelNode)) {
      continue;
    }
    if (id === '') {
      return root;
    }
    for (const contained of navigateMember([root], 'contained', ctx)) {
      if (
        contained instanceof ModelNode &&
        isJsonObject(contained.value) &&
        ownString(contained.value, 'id') === id
      ) {
        return contained;
      }
    }
  }
  return undefined;
}

/**
 * The root resources a reference in `item` is resolved against: the container of the resource the
 * item is part of, so each resource of an input with several keeps its own contained resources.
 * `%rootResource` takes its place for an item that is part of no resource, and for one in
 * `%resource` when `%rootResource` does not hold that container, which only happens when the host
 * sets it; with the default values it always does.
 */
function rootsFor(item: Item, ctx: EvalContext): Collection {
  const roots = lookUpVariable(ctx, 'rootResource') ?? EMPTY;
  const resource = item instanceof ModelNode ? enclosingResource(item) : undefined;
  if (resource === undefined) {
    return roots;
  }
  const container = containerOf(resource);
  if (isIn(resource, lookUpVariable(ctx, 'resource') ?? EMPTY) && !isIn(container, roots)) {
    return roots;
  }
  return [container];
}

/** Whether a collection has the resource node, or another node holding the same JSON object. */
function isIn(resource: ModelNode, items: Collection): boolean {
  return items.some(
    (item) => item === resource || (item instanceof ModelNode && item.value === resource.value),
  );
}

/** Where to look for the Bundle around a reference: the item itself, then its root resources. */
function anchorsOf(item: Item, ctx: EvalContext): Collection {
  const roots = rootsFor(item, ctx);
  return item instanceof ModelNode ? [item, ...roots] : roots;
}

/** The nearest node, the node itself or an ancestor, that holds a `Bundle`. */
function enclosingBundle(anchor: Item): ModelNode | undefined {
  if (!(anchor instanceof ModelNode)) {
    return undefined;
  }
  for (let node: ModelNode | undefined = anchor; node !== undefined; node = node.parent) {
    if (resourceTypeOf(node.value) === 'Bundle') {
      return node;
    }
  }
  return undefined;
}

/** The entry of `bundle` that `node` is part of, if it is part of one. */
function entryOf(node: Item, bundle: ModelNode): ModelNode | undefined {
  if (!(node instanceof ModelNode)) {
    return undefined;
  }
  for (let current: ModelNode | undefined = node; current !== undefined; current = current.parent) {
    if (current.parent === bundle) {
      return current;
    }
  }
  return undefined;
}

/** A reference split for matching against Bundle entries. */
interface ParsedReference {
  /** The reference without its `/_history/[version]` suffix. */
  readonly url: string;
  /** The version the reference asks for, if any. */
  readonly version: string | undefined;
  /** For a relative `Type/id` reference, the resource type and id. */
  readonly type: string | undefined;
  readonly id: string | undefined;
}

/** `[url]/_history/[version]`; FHIR ids and versions are 1–64 of `[A-Za-z0-9\-.]`. */
const VERSIONED = /^(.*)\/_history\/([A-Za-z0-9\-.]{1,64})$/;
/** A relative literal reference, `Type/id` ([FHIR references](https://hl7.org/fhir/R5/references.html#literal)). */
const RELATIVE = /^([A-Z][A-Za-z0-9]*)\/([A-Za-z0-9\-.]{1,64})$/;
/**
 * A RESTful URL, `[base]/[Type]/[id]`, optionally with a version: the RESTful URL regex of
 * [FHIR references](https://hl7.org/fhir/R5/references.html#regex). The first group is the base,
 * with its trailing slash.
 */
const RESTFUL =
  /^(https?:\/\/(?:[A-Za-z0-9\-\\.:%$]*\/)+)[A-Z][A-Za-z0-9]*\/[A-Za-z0-9\-.]{1,64}(?:\/_history\/[A-Za-z0-9\-.]{1,64})?$/;

function parseReference(reference: string): ParsedReference {
  const versioned = VERSIONED.exec(reference);
  const url = versioned?.[1] ?? reference;
  const relative = RELATIVE.exec(url);
  return { url, version: versioned?.[2], type: relative?.[1], id: relative?.[2] };
}

/**
 * The resource of the first entry of `bundle` that the reference matches
 * ([Bundle references](https://hl7.org/fhir/R5/bundle.html#references)).
 *
 * @param referring - The entry the reference is in, whose `fullUrl` gives a relative reference
 *   its base.
 */
function findInBundle(
  bundle: ModelNode,
  target: ParsedReference,
  referring: ModelNode | undefined,
  ctx: EvalContext,
): ModelNode | undefined {
  const base = target.type === undefined ? undefined : restfulBase(referring);
  // A relative reference with a base is matched as the absolute URL it stands for.
  const url = base === undefined ? target.url : base + target.url;
  const byTypeAndId = target.type !== undefined && base === undefined;
  for (const entry of navigateMember([bundle], 'entry', ctx)) {
    if (!(entry instanceof ModelNode) || !isJsonObject(entry.value)) {
      continue;
    }
    const resource = Object.hasOwn(entry.value, 'resource') ? entry.value.resource : undefined;
    if (!isJsonObject(resource)) {
      continue;
    }
    const matches = byTypeAndId
      ? resourceTypeOf(resource) === target.type && ownString(resource, 'id') === target.id
      : ownString(entry.value, 'fullUrl') === url;
    if (!matches || !matchesVersion(target, resource)) {
      continue;
    }
    for (const node of navigateMember([entry], 'resource', ctx)) {
      if (node instanceof ModelNode) {
        return node;
      }
    }
  }
  return undefined;
}

/** The base of the entry's `fullUrl` when it is a RESTful URL, such as `https://a.example/fhir/`. */
function restfulBase(entry: ModelNode | undefined): string | undefined {
  const fullUrl =
    entry !== undefined && isJsonObject(entry.value)
      ? ownString(entry.value, 'fullUrl')
      : undefined;
  return fullUrl === undefined ? undefined : RESTFUL.exec(fullUrl)?.[1];
}

/** Whether the resource has the version the reference asks for, if it asks for one. */
function matchesVersion(target: ParsedReference, resource: JsonObject): boolean {
  if (target.version === undefined) {
    return true;
  }
  const meta = Object.hasOwn(resource, 'meta') ? resource.meta : undefined;
  return isJsonObject(meta) && ownString(meta, 'versionId') === target.version;
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof JsonNumber)
  );
}

function ownString(json: JsonObject, key: string): string | undefined {
  if (!Object.hasOwn(json, key)) {
    return undefined;
  }
  const value = json[key];
  return typeof value === 'string' ? value : undefined;
}
