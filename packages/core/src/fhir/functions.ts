/**
 * The FHIR additions to the function library
 * ([R5 §2.1.9.1.5](https://hl7.org/fhir/R5/fhirpath.html#functions); the same in
 * [R4](https://hl7.org/fhir/R4/fhirpath.html#functions) and the
 * [R6 draft §2.1.9.3](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#functions)), which the
 * default function registry includes.
 *
 * `extension()`, `hasValue()`, `getValue()` and `resolve()` need no host. `memberOf()`,
 * `subsumes()`, `subsumedBy()`, `conformsTo()` and `htmlChecks()` need a terminology server, a
 * validator or an HTML checker; they are registered so expressions that use them compile, and
 * return empty until the host hooks of [T0021](https://github.com/losol/callis/blob/main/docs/tasks/T0021-hooks-async.md)
 * back them.
 */
import {
  defineValueFunction,
  type FunctionDefinition,
  type ParamSpec,
} from '../functions/define.ts';
import { ModelNode } from '../model/model-node.ts';
import { type Collection, EMPTY, fromBoolean, type Item } from '../runtime/collection.ts';
import { navigateMember } from '../runtime/navigation.ts';
import { toSystemValue } from '../runtime/node-value.ts';
import { singleton } from '../runtime/singleton.ts';
import { DateValue } from '../values/datetime/date.ts';
import { DateTimeValue } from '../values/datetime/datetime.ts';
import { TimeValue } from '../values/datetime/time.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { resolveFunction } from './resolve.ts';

/**
 * `extension(url)`: the extensions of the input items whose `url` is the given URL, a shortcut for
 * `extension.where(url = url)`. Works on resources, complex values and, with a model, on FHIR
 * primitives, whose extensions are in their `_name` object. Empty when the input or the URL is
 * empty.
 *
 * @see https://hl7.org/fhir/R5/fhirpath.html#functions
 * @throws {@link FhirPathEvaluationError} `eval/singleton-expected` or `eval/type-mismatch` when
 *   `url` is not a single String.
 */
export const extensionFunction: FunctionDefinition = defineValueFunction(
  'extension',
  [{ kind: 'value', name: 'url' }],
  (input, [url = EMPTY], call) => {
    const wanted = singleton(url, 'String', asString);
    if (wanted === undefined || wanted === '' || input.length === 0) {
      return EMPTY;
    }
    const items: Item[] = [];
    for (const extension of navigateMember(input, 'extension', call.ctx)) {
      if (extension instanceof ModelNode && extensionUrl(extension) === wanted) {
        items.push(extension);
      }
    }
    return items.length === 0 ? EMPTY : items;
  },
);

/**
 * `hasValue()`: true when the input is a single primitive that has a value, and false otherwise:
 * for a FHIR primitive with only extensions, a complex value, a Quantity, empty input or more than
 * one item. The suites expect false where R4 and R5 say empty
 * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#hasvalue-is-always-a-boolean)).
 *
 * @see https://hl7.org/fhir/R5/fhirpath.html#functions
 */
export const hasValueFunction: FunctionDefinition = defineValueFunction(
  'hasValue',
  0,
  (input) => fromBoolean(primitiveValueOf(input) !== undefined),
  { returns: { type: 'Boolean', singleton: true } },
);

/**
 * `getValue()`: the System value of a single primitive that has a value, as `hasValue()` decides,
 * and empty otherwise. The value no longer carries the node's model type or extensions:
 * `Patient.birthDate.getValue() is System.Date` is true.
 *
 * @see https://hl7.org/fhir/R5/fhirpath.html#functions
 */
export const getValueFunction: FunctionDefinition = defineValueFunction(
  'getValue',
  0,
  (input) => {
    const value = primitiveValueOf(input);
    return value === undefined ? EMPTY : [value];
  },
  { returns: { singleton: true } },
);

/**
 * A function that needs a host hook ([T0021](https://github.com/losol/callis/blob/main/docs/tasks/T0021-hooks-async.md#host-hooks)).
 * Without one it returns empty and never throws; its arguments are still evaluated, so their
 * errors surface.
 */
function defineHostFunction(name: string, params: readonly ParamSpec[]): FunctionDefinition {
  return defineValueFunction(name, params, () => EMPTY, {
    returns: { type: 'Boolean', singleton: true },
  });
}

/**
 * `memberOf(valueset)`: whether a code is in a value set. Needs a terminology hook (T0021).
 *
 * @see https://hl7.org/fhir/R5/fhirpath.html#functions
 */
export const memberOfFunction: FunctionDefinition = defineHostFunction('memberOf', [
  { kind: 'value', name: 'valueset' },
]);

/**
 * `subsumes(code)`: whether the input code subsumes the given one. Needs a terminology hook
 * (T0021).
 *
 * @see https://hl7.org/fhir/R5/fhirpath.html#functions
 */
export const subsumesFunction: FunctionDefinition = defineHostFunction('subsumes', [
  { kind: 'value', name: 'code' },
]);

/**
 * `subsumedBy(code)`: whether the given code subsumes the input code. Needs a terminology hook
 * (T0021).
 *
 * @see https://hl7.org/fhir/R5/fhirpath.html#functions
 */
export const subsumedByFunction: FunctionDefinition = defineHostFunction('subsumedBy', [
  { kind: 'value', name: 'code' },
]);

/**
 * `conformsTo(structure)`: whether the input conforms to a profile. Needs a `conformsTo` hook
 * (T0021).
 *
 * @see https://hl7.org/fhir/R5/fhirpath.html#functions
 */
export const conformsToFunction: FunctionDefinition = defineHostFunction('conformsTo', [
  { kind: 'value', name: 'structure' },
]);

/**
 * `htmlChecks()`: whether narrative XHTML follows FHIR's HTML rules. Needs an `htmlChecks` hook
 * (T0021).
 *
 * @see https://hl7.org/fhir/R5/fhirpath.html#functions
 */
export const htmlChecksFunction: FunctionDefinition = defineHostFunction('htmlChecks', []);

/** The FHIR functions of the default registry. */
export const FHIR_FUNCTIONS: readonly FunctionDefinition[] = Object.freeze([
  extensionFunction,
  hasValueFunction,
  getValueFunction,
  resolveFunction,
  memberOfFunction,
  subsumesFunction,
  subsumedByFunction,
  conformsToFunction,
  htmlChecksFunction,
]);

/** The item as a String, or undefined when it is not one. */
function asString(item: Item): string | undefined {
  const value = toSystemValue(item);
  return typeof value === 'string' ? value : undefined;
}

/** The own `url` of an extension's JSON object, if it is a string. */
function extensionUrl(extension: ModelNode): string | undefined {
  const json = extension.value;
  if (
    typeof json !== 'object' ||
    json === null ||
    !Object.hasOwn(json, 'url') ||
    !('url' in json)
  ) {
    return undefined;
  }
  return typeof json.url === 'string' ? json.url : undefined;
}

/**
 * The primitive value of a single item: the System value of a FHIR primitive, of an untyped input
 * value or of a System value, when it is a Boolean, String, Integer, Long, Decimal, Date, DateTime
 * or Time. Undefined for anything else, including a primitive with only extensions, whose node
 * holds no value.
 */
function primitiveValueOf(input: Collection): Item | undefined {
  if (input.length !== 1) {
    return undefined;
  }
  const [item] = input;
  const value = item === undefined ? undefined : toSystemValue(item);
  return value !== undefined && isPrimitive(value) ? value : undefined;
}

function isPrimitive(value: Item): boolean {
  switch (typeof value) {
    case 'boolean':
    case 'string':
    case 'number':
    case 'bigint':
      return true;
    default:
      return (
        value instanceof Decimal ||
        value instanceof DateValue ||
        value instanceof DateTimeValue ||
        value instanceof TimeValue
      );
  }
}
