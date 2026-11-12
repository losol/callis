/**
 * The FHIR additions to the function library
 * ([R5 §2.1.9.1.5](https://hl7.org/fhir/R5/fhirpath.html#functions); the same in
 * [R4](https://hl7.org/fhir/R4/fhirpath.html#functions) and the
 * [R6 draft §2.1.9.3](https://hl7.org/fhir/6.0.0-snapshot1/fhirpath.html#functions)), which the
 * default function registry includes.
 *
 * `extension()`, `hasValue()` and `getValue()` need no host, and `resolve()` finds what is in the
 * data on its own. `memberOf()`, `subsumes()`, `subsumedBy()`, `conformsTo()` and `htmlChecks()`
 * need a terminology server, a validator or an HTML checker, which the host supplies as hooks
 * ([T0021: host hooks](https://github.com/losol/callis/blob/main/docs/tasks/T0021-hooks-async.md#host-hooks),
 * [spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#hook-backed-functions-errors-and-empty-results)).
 * Without the hook a function gives empty and never throws; its arguments are still evaluated
 * and checked, so their errors surface. With one, it gives what the hook answers, and empty where
 * the hook answers undefined; an error the hook throws ends the evaluation.
 */
import {
  defineFunction,
  defineValueFunction,
  type FunctionDefinition,
  type TypeExpectation,
  type TypeHint,
  valueArg,
} from '../functions/define.ts';
import { ModelNode } from '../model/model-node.ts';
import { type Collection, EMPTY, fromBoolean, type Item } from '../runtime/collection.ts';
import type { BoundHooks, Coding, HookContext, SubsumptionOutcome } from '../runtime/hooks.ts';
import { andThen, type MaybePromise } from '../runtime/maybe-promise.ts';
import { navigateMember } from '../runtime/navigation.ts';
import { toSystemValue } from '../runtime/node-value.ts';
import { singleton } from '../runtime/singleton.ts';
import { DateValue } from '../values/datetime/date.ts';
import { DateTimeValue } from '../values/datetime/datetime.ts';
import { TimeValue } from '../values/datetime/time.ts';
import { Decimal } from '../values/decimal/decimal.ts';
import { codedValueOf, codingsOf, hookContext, htmlOf, isSameCoding, jsonOf } from './hooks.ts';
import { resolveFunction } from './resolve.ts';

/** A URL argument: one String. */
const URL: TypeExpectation = { type: 'String', singleton: true };

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
  [{ kind: 'value', name: 'url', expects: URL }],
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
  { returns: { collection: true, perItem: true } },
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

const BOOLEAN: TypeHint = { type: 'Boolean', singleton: true };

/**
 * `memberOf(valueset)`: whether the single input item, a `code` or String, a `Coding` or a
 * `CodeableConcept`, is in the value set with the canonical URL `valueset`, as the terminology
 * provider's `memberOf` answers. Empty without a provider, for empty or several input items, for
 * an item that is not coded, for an empty `valueset`, and where the provider cannot tell, as the
 * R5 text asks for a value set that cannot be resolved; the provider throws to raise the error of
 * the R4 text instead.
 *
 * @see https://hl7.org/fhir/R5/fhirpath.html#functions
 * @throws {@link FhirPathEvaluationError} `eval/singleton-expected` or `eval/type-mismatch` when
 *   `valueset` is not a single String.
 */
export const memberOfFunction: FunctionDefinition = defineFunction({
  name: 'memberOf',
  params: [{ kind: 'value', name: 'valueset', expects: URL }],
  returns: BOOLEAN,
  async: true,
  impl: (call, input, args) => {
    const valueSet = singleton(valueArg(args, 0), 'String', asString);
    const memberOf = call.ctx.hooks.memberOf;
    const [item] = input;
    if (valueSet === undefined || valueSet === '' || memberOf === undefined) {
      return EMPTY;
    }
    const coded =
      item === undefined || input.length !== 1 ? undefined : codedValueOf(item, call.ctx.model);
    if (coded === undefined) {
      return EMPTY;
    }
    return andThen(memberOf(coded, valueSet, hookContext(call.ctx)), fromBoolean);
  },
});

/**
 * `subsumes(code)`: whether the single input `Coding` or `CodeableConcept` is equivalent to or
 * subsumes the single given one: true when any coding of the input is, by the terminology
 * provider's `subsumes`, equivalent to or subsumes any coding of the argument. Two codings with
 * the same system and code are equivalent without a call.
 *
 * Empty without a provider, when the input or the argument is not a single `Coding` or
 * `CodeableConcept`, for a concept without codings, and when no pair matches and the provider
 * could not tell for one of them, as the R5 text asks for codings of different systems; false
 * when every pair is known not to match.
 *
 * @see https://hl7.org/fhir/R5/fhirpath.html#functions
 */
export const subsumesFunction: FunctionDefinition = defineSubsumption(
  'subsumes',
  (outcome) => outcome === 'equivalent' || outcome === 'subsumes',
);

/**
 * `subsumedBy(code)`: whether the single input `Coding` or `CodeableConcept` is equivalent to or
 * subsumed by the single given one, with the rules of `subsumes()` the other way round.
 *
 * @see https://hl7.org/fhir/R5/fhirpath.html#functions
 */
export const subsumedByFunction: FunctionDefinition = defineSubsumption(
  'subsumedBy',
  (outcome) => outcome === 'equivalent' || outcome === 'subsumed-by',
);

function defineSubsumption(
  name: string,
  matches: (outcome: SubsumptionOutcome) => boolean,
): FunctionDefinition {
  return defineFunction({
    name,
    params: [{ kind: 'value', name: 'code' }],
    returns: BOOLEAN,
    async: true,
    impl: (call, input, args) => {
      const subsumes = call.ctx.hooks.subsumes;
      const code = valueArg(args, 0);
      const [source] = input;
      const [given] = code;
      if (subsumes === undefined || source === undefined || given === undefined) {
        return EMPTY;
      }
      const model = call.ctx.model;
      const sources = input.length === 1 ? codingsOf(source, model) : undefined;
      const givens = code.length === 1 ? codingsOf(given, model) : undefined;
      if (sources === undefined || givens === undefined) {
        return EMPTY;
      }
      const pairs: (readonly [Coding, Coding])[] = [];
      for (const a of sources) {
        for (const b of givens) {
          pairs.push([a, b]);
        }
      }
      return andThen(
        relate(pairs, 0, false, subsumes, hookContext(call.ctx), matches),
        fromBoolean,
      );
    },
  });
}

/**
 * Asks the provider about each pair in turn until one matches: true for the first match, and
 * otherwise false when every outcome was known, or empty when one was not.
 */
function relate(
  pairs: readonly (readonly [Coding, Coding])[],
  index: number,
  undecided: boolean,
  subsumes: NonNullable<BoundHooks['subsumes']>,
  context: HookContext,
  matches: (outcome: SubsumptionOutcome) => boolean,
): MaybePromise<boolean | undefined> {
  const pair = pairs[index];
  if (pair === undefined) {
    return undecided || pairs.length === 0 ? undefined : false;
  }
  const [a, b] = pair;
  const outcome: MaybePromise<SubsumptionOutcome | undefined> = isSameCoding(a, b)
    ? 'equivalent'
    : subsumes(a, b, context);
  return andThen(outcome, (result) =>
    result !== undefined && matches(result)
      ? true
      : relate(pairs, index + 1, undecided || result === undefined, subsumes, context, matches),
  );
}

/**
 * `conformsTo(structure)`: whether the single input item conforms to the profile with the
 * canonical URL `structure`, as the `conformsTo` hook answers for the item's JSON. Empty without
 * a hook, for empty or several input items, for an empty `structure`, and where the hook cannot
 * tell, as the R5 and R6 texts ask for a profile that cannot be resolved; the hook throws to raise
 * the error of the R4 text and the suites instead.
 *
 * @see https://hl7.org/fhir/R5/fhirpath.html#functions
 * @throws {@link FhirPathEvaluationError} `eval/singleton-expected` or `eval/type-mismatch` when
 *   `structure` is not a single String.
 */
export const conformsToFunction: FunctionDefinition = defineFunction({
  name: 'conformsTo',
  params: [{ kind: 'value', name: 'structure', expects: URL }],
  returns: BOOLEAN,
  async: true,
  impl: (call, input, args) => {
    const profile = singleton(valueArg(args, 0), 'String', asString);
    const conformsTo = call.ctx.hooks.conformsTo;
    const [item] = input;
    if (profile === undefined || profile === '' || conformsTo === undefined) {
      return EMPTY;
    }
    if (item === undefined || input.length !== 1) {
      return EMPTY;
    }
    return andThen(conformsTo(jsonOf(item), profile, hookContext(call.ctx)), fromBoolean);
  },
});

/**
 * `htmlChecks()`: whether the single input item, narrative `xhtml` or a string read as the
 * content of a `div`, follows FHIR's rules for narrative XHTML, as the `htmlChecks` hook answers.
 * Empty without a hook, for empty or several input items, for an item that is not a string, and
 * where the hook cannot tell. The hook gets the text and whether it is the `xhtml` element itself
 * or a string ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#htmlchecks-on-strings)).
 *
 * @see https://hl7.org/fhir/R5/fhirpath.html#functions
 */
export const htmlChecksFunction: FunctionDefinition = defineFunction({
  name: 'htmlChecks',
  params: [],
  returns: BOOLEAN,
  async: true,
  impl: (call, input) => {
    const htmlChecks = call.ctx.hooks.htmlChecks;
    const [item] = input;
    if (htmlChecks === undefined || item === undefined || input.length !== 1) {
      return EMPTY;
    }
    const html = htmlOf(item);
    if (html === undefined) {
      return EMPTY;
    }
    return andThen(
      htmlChecks(html.text, { ...hookContext(call.ctx), kind: html.kind }),
      fromBoolean,
    );
  },
});

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
