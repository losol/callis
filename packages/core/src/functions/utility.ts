/**
 * The utility functions `trace()`, `now()`, `timeOfDay()` and `today()`
 * ([N1 §5.9](https://hl7.org/fhirpath/N1/#utility-functions)).
 */
import { type Collection, EMPTY, type Item } from '../runtime/collection.ts';
import { andThen, type MaybePromise, mapSequential } from '../runtime/maybe-promise.ts';
import { toSystemValue } from '../runtime/node-value.ts';
import { singleton } from '../runtime/singleton.ts';
import {
  type CallContext,
  defineFunction,
  defineValueFunction,
  type FunctionDefinition,
  type LambdaArg,
  lambdaArg,
  valueArg,
} from './define.ts';

/**
 * `trace(name [, projection])`: sends the input, or the projection evaluated for each input item
 * as `select()` does, to the evaluation's `trace` hook, and returns the input unchanged.
 *
 * `name` must be a single String; an empty `name` traces under the name `''`. The projection is
 * evaluated even when there is no hook, so adding a hook never changes a result or an error
 * ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#trace-names-and-projections)).
 *
 * @see https://hl7.org/fhirpath/N1/#tracename-string-projection-expression-collection
 */
export const traceFunction: FunctionDefinition = defineFunction({
  name: 'trace',
  params: [
    { kind: 'value', name: 'name', expects: { type: 'String', singleton: true } },
    { kind: 'lambda', name: 'projection', optional: true },
  ],
  returns: { fromInput: true },
  async: true,
  impl: (call, input, args) => {
    const name = singleton(valueArg(args, 0), 'String', asString) ?? '';
    const projection = lambdaArg(args, 1);
    const traced = projection === undefined ? input : project(input, projection);
    return andThen(traced, (items) => andThen(send(call, name, items), () => input));
  },
});

/**
 * `now()`: the current date and time, with the evaluation's timezone offset (UTC by default).
 * The same value every time within one evaluation.
 *
 * @see https://hl7.org/fhirpath/N1/#now-datetime
 */
export const nowFunction: FunctionDefinition = defineValueFunction(
  'now',
  0,
  (_input, _args, call) => [call.ctx.now().now],
  { returns: { type: 'DateTime', singleton: true } },
);

/**
 * `timeOfDay()`: the current time of day at the evaluation's timezone offset.
 *
 * @see https://hl7.org/fhirpath/N1/#timeofday-time
 */
export const timeOfDayFunction: FunctionDefinition = defineValueFunction(
  'timeOfDay',
  0,
  (_input, _args, call) => [call.ctx.now().timeOfDay],
  { returns: { type: 'Time', singleton: true } },
);

/**
 * `today()`: the current date at the evaluation's timezone offset.
 *
 * @see https://hl7.org/fhirpath/N1/#today-date
 */
export const todayFunction: FunctionDefinition = defineValueFunction(
  'today',
  0,
  (_input, _args, call) => [call.ctx.now().today],
  { returns: { type: 'Date', singleton: true } },
);

/** The utility functions of the standard library. */
export const UTILITY_FUNCTIONS: readonly FunctionDefinition[] = Object.freeze([
  traceFunction,
  nowFunction,
  timeOfDayFunction,
  todayFunction,
]);

/** The item as a String, or undefined when it is not one. */
function asString(item: Item): string | undefined {
  const value = toSystemValue(item);
  return typeof value === 'string' ? value : undefined;
}

/** The projection evaluated for each item, with the item as `$this` and its `$index`. */
function project(input: Collection, projection: LambdaArg): MaybePromise<Collection> {
  return andThen(
    mapSequential(input, (item, index) => projection.forItem(item, index)),
    (results) => {
      const items = results.flat();
      return items.length === 0 ? EMPTY : items;
    },
  );
}

function send(call: CallContext, name: string, items: Collection): MaybePromise<void> {
  return call.ctx.trace?.(name, items, call.span);
}
