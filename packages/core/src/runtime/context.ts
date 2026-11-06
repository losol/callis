/**
 * The state of one evaluation, and the iteration variables of the current lambda
 * ([T0008: compiling to closures](https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#compiling-to-closures)).
 *
 * A compiled expression holds no evaluation state. Each evaluation creates an {@link EvalContext},
 * and lambdas get a new {@link Frame} that points to the enclosing one. Both are passed as
 * parameters, never stored globally, so a compiled expression is reentrant and can run in several
 * overlapping async evaluations at once.
 */
import type { ModelProvider } from '../model/model-provider.ts';
import type { NowSnapshot } from '../values/datetime/now.ts';
import type { UnitSystem } from '../values/quantity/unit-system.ts';
import type { Collection, Item } from './collection.ts';
import type { MaybePromise } from './maybe-promise.ts';

/**
 * Everything one evaluation needs. Created per evaluation by the API and read-only afterwards.
 *
 * Its `model`, `units` and `timezoneOffset` fields match the context the equality and ordering
 * kernels take (T0009), so an `EvalContext` can be passed to them as it is. Later tasks add hooks,
 * limits and a cancellation signal (T0012, T0021).
 */
export interface EvalContext {
  /** Whether this is an `evaluateAsync()` evaluation, where hooks and functions may be async. */
  readonly isAsync: boolean;
  /** `%context`: the input of the evaluation ([N1 §9](https://hl7.org/fhirpath/N1/#environment-variables)). */
  readonly context: Collection;
  /**
   * The user variables, by name without the `%`. A null-prototype object, so a name such as
   * `constructor` is only found when the host defined it.
   */
  readonly variables: Readonly<Record<string, Collection>>;
  /** The model, or undefined for model-less evaluation of plain JSON. */
  readonly model: ModelProvider | undefined;
  /** The unit system for quantities. */
  readonly units: UnitSystem;
  /**
   * The offset, in minutes east of UTC, assumed for date/time values without one; 0 (UTC) unless
   * the `timezoneOffset` option says otherwise ([ADR-0012](https://github.com/losol/callis/blob/main/docs/adr/0012-evaluation-defaults.md)).
   */
  readonly timezoneOffset: number;
  /**
   * The current date and time of this evaluation. Taken once, on first use, so `now()` gives the
   * same value every time within one evaluation.
   */
  now(): NowSnapshot;
}

/**
 * The iteration variables of a lambda: `$this`, `$index` and `$total`
 * ([N1 §5](https://hl7.org/fhirpath/N1/#functions), [N1 §7](https://hl7.org/fhirpath/N1/#aggregates)).
 *
 * The root frame of an evaluation has the input as `$this` and no index. Each lambda call gets a
 * frame for its item, whose `parent` is the frame where the function was called.
 */
export interface Frame {
  /** `$this`: the item being evaluated, as a collection; the input in the root frame. */
  readonly this: Collection;
  /** `$index`: the position of the item, or undefined outside an iterating lambda. */
  readonly index: number | undefined;
  /** `$total`: the accumulator of `aggregate()` (phase 2), or undefined elsewhere. */
  readonly total: Collection | undefined;
  /** The enclosing frame, or undefined for the root frame. */
  readonly parent: Frame | undefined;
}

/**
 * A compiled expression node: a closure that evaluates the node against the focus. It returns a
 * promise only in async mode, and only when an async hook or function was reached.
 */
export type Evaluator = (
  ctx: EvalContext,
  focus: Collection,
  frame: Frame,
) => MaybePromise<Collection>;

/** The frame an evaluation starts with: `$this` is the input. */
export function rootFrame(input: Collection): Frame {
  return { this: input, index: undefined, total: undefined, parent: undefined };
}

/**
 * The frame of one lambda call for `item` at `index` ([N1 §5](https://hl7.org/fhirpath/N1/#functions)).
 *
 * @param focus - The item as a collection; also the focus the lambda is evaluated with.
 */
export function itemFrame(
  parent: Frame,
  focus: readonly [Item],
  index: number,
  total?: Collection,
): Frame {
  return { this: focus, index, total, parent };
}
