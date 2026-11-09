/**
 * How the FHIR functions reach the host hooks
 * ([T0021: host hooks](https://github.com/losol/callis/blob/main/docs/tasks/T0021-hooks-async.md#host-hooks)):
 * the contexts of the calls, and the arguments built from the input items. The contracts are in
 * `runtime/hooks.ts`; the functions in `functions.ts` and `resolve.ts` call the bound hooks of
 * `EvalContext.hooks` with what this module gives them.
 */
import { JsonNumber } from '../model/lossless-json.ts';
import { ModelNode } from '../model/model-node.ts';
import type { ModelProvider } from '../model/model-provider.ts';
import type { Item } from '../runtime/collection.ts';
import type { EvalContext } from '../runtime/context.ts';
import type { CodedValue, Coding, HookContext, ResolveContext } from '../runtime/hooks.ts';
import { toSystemValue } from '../runtime/node-value.ts';
import { enclosingResource } from './variables.ts';

type JsonObject = Readonly<Record<string, unknown>>;

/** The context of a hook call: the evaluation's signal. */
export function hookContext(ctx: EvalContext): HookContext {
  return { signal: ctx.signal };
}

/** The context of a `resolve` hook call for a reference found in `item`. */
export function resolveContext(ctx: EvalContext, item: Item): ResolveContext {
  const resource = item instanceof ModelNode ? enclosingResource(item)?.value : undefined;
  return { signal: ctx.signal, resource };
}

/**
 * An item as a hook receives it: the JSON value of an input node, or a System value as it is,
 * such as the string of a literal.
 */
export function jsonOf(item: Item): unknown {
  return item instanceof ModelNode ? item.value : item;
}

/**
 * The input of `memberOf()` as a coded value
 * ([R5 §2.1.9.1.5](https://hl7.org/fhir/R5/fhirpath.html#functions)): a `code`, `string` or
 * other String value, a `Coding` or a `CodeableConcept`. Undefined for anything else, such as a
 * Quantity or a `HumanName`.
 *
 * With a model, a typed node is a `Coding` or `CodeableConcept` when its type is one, or
 * inherits from one. Without a model, or for a node the model does not type, an object with a
 * `coding` array is a `CodeableConcept` and an object with a string `code` or `system` a
 * `Coding`.
 */
export function codedValueOf(item: Item, model: ModelProvider | undefined): CodedValue | undefined {
  const value = toSystemValue(item);
  if (typeof value === 'string') {
    return { kind: 'code', codings: [{ code: value }], value };
  }
  const json = complexJsonOf(item);
  if (json === undefined) {
    return undefined;
  }
  switch (codedKindOf(item, json, model)) {
    case 'Coding':
      return { kind: 'Coding', codings: [codingOf(json)], value: json };
    case 'CodeableConcept':
      return { kind: 'CodeableConcept', codings: codingsOfConcept(json), value: json };
    default:
      return undefined;
  }
}

/**
 * The codings of an input or argument of `subsumes()` and `subsumedBy()`, which take a `Coding`
 * or a `CodeableConcept` only ([R5 §2.1.9.1.5](https://hl7.org/fhir/R5/fhirpath.html#functions)):
 * the one coding, or those of the concept. Undefined for anything else, a plain code included.
 */
export function codingsOf(
  item: Item,
  model: ModelProvider | undefined,
): readonly Coding[] | undefined {
  const json = complexJsonOf(item);
  if (json === undefined) {
    return undefined;
  }
  switch (codedKindOf(item, json, model)) {
    case 'Coding':
      return [codingOf(json)];
    case 'CodeableConcept':
      return codingsOfConcept(json);
    default:
      return undefined;
  }
}

/** Whether two codings are the same code: the same `code` in the same `system`, any version. */
export function isSameCoding(a: Coding, b: Coding): boolean {
  return a.code !== undefined && a.code === b.code && a.system === b.system;
}

/**
 * The text of an `htmlChecks()` input and what it is: the `xhtml` element itself for a node the
 * model types as `xhtml`, and the content of a `div` for any other String value, as the R6 draft
 * reads a string ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#htmlchecks-on-strings)).
 * Undefined for an item that is not a string, which gives empty without a hook call.
 */
export function htmlOf(
  item: Item,
): { readonly text: string; readonly kind: 'xhtml' | 'string' } | undefined {
  const text = toSystemValue(item);
  if (typeof text !== 'string') {
    return undefined;
  }
  const kind = item instanceof ModelNode && item.type?.name === 'xhtml' ? 'xhtml' : 'string';
  return { text, kind };
}

/** The JSON object of a node that holds a complex value, if the item is one. */
function complexJsonOf(item: Item): JsonObject | undefined {
  return item instanceof ModelNode && isJsonObject(item.value) ? item.value : undefined;
}

function codedKindOf(
  item: Item,
  json: JsonObject,
  model: ModelProvider | undefined,
): 'Coding' | 'CodeableConcept' | undefined {
  if (model !== undefined && item instanceof ModelNode && item.type !== undefined) {
    const coding = model.getType('Coding');
    if (coding !== undefined && model.isSubtypeOf(item.type, coding)) {
      return 'Coding';
    }
    const concept = model.getType('CodeableConcept');
    if (concept !== undefined && model.isSubtypeOf(item.type, concept)) {
      return 'CodeableConcept';
    }
    return undefined;
  }
  if (Object.hasOwn(json, 'coding') && Array.isArray(json.coding)) {
    return 'CodeableConcept';
  }
  if (ownString(json, 'code') !== undefined || ownString(json, 'system') !== undefined) {
    return 'Coding';
  }
  return undefined;
}

/** The string elements of a `Coding` object; an element that is not a string is left out. */
function codingOf(json: JsonObject): Coding {
  const coding: { -readonly [K in keyof Coding]: Coding[K] } = {};
  for (const key of ['system', 'version', 'code', 'display'] as const) {
    const value = ownString(json, key);
    if (value !== undefined) {
      coding[key] = value;
    }
  }
  return coding;
}

function codingsOfConcept(json: JsonObject): readonly Coding[] {
  const codings: Coding[] = [];
  const list = Object.hasOwn(json, 'coding') ? json.coding : undefined;
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (isJsonObject(entry)) {
        codings.push(codingOf(entry));
      }
    }
  }
  return codings;
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
