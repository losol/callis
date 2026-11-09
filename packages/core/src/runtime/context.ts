/**
 * The state of one evaluation, and the iteration variables of the current lambda
 * ([T0008: compiling to closures](https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#compiling-to-closures)).
 *
 * A compiled expression holds no evaluation state. Each evaluation creates an {@link EvalContext},
 * and lambdas get a new {@link Frame} that points to the enclosing one. Both are passed as
 * parameters, never stored globally, so a compiled expression is reentrant and can run in several
 * overlapping async evaluations at once.
 */
import type { SourceSpan } from '../errors/source-span.ts';
import type { ModelProvider } from '../model/model-provider.ts';
import type { NowSnapshot } from '../values/datetime/now.ts';
import type { UnitSystem } from '../values/quantity/unit-system.ts';
import type { Collection, Item } from './collection.ts';
import type { ModelEquivalence } from './equality.ts';
import type { MaybePromise } from './maybe-promise.ts';

/**
 * Looks up a variable that the environment of an evaluation defines, by name without the `%`.
 * Returns undefined for a name it does not define.
 */
export type EnvironmentLookup = (name: string) => Collection | undefined;

/**
 * Where `trace()` sends its output: the name, the traced items and the span of the call
 * ([N1 §5.9.1](https://hl7.org/fhirpath/N1/#tracename-string-projection-expression-collection)).
 * The API builds it from the host's `trace` hook. It returns a promise only in async mode, when
 * the hook did; in sync mode a hook that returns a thenable raises `eval/async-in-sync`.
 */
export type TraceSink = (name: string, items: Collection, span: SourceSpan) => MaybePromise<void>;

/**
 * Everything one evaluation needs. Created per evaluation by the API and read-only afterwards.
 *
 * Its `model`, `units` and `timezoneOffset` fields match the context the equality and ordering
 * kernels take (T0009), and `model` and `lenientChoiceSuffix` the context navigation takes, so an
 * `EvalContext` can be passed to them as it is. Later tasks add the other hooks, limits and a
 * cancellation signal (T0021, T0042).
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
  /**
   * The variables the environment defines besides `%context` and `%ucum`: the FHIR variables
   * `%resource`, `%rootResource`, `%sct`, `%loinc`, `` %`vs-[name]` `` and `` %`ext-[name]` ``
   * ([R5 §2.1.9.1.4](https://hl7.org/fhir/R5/fhirpath.html#variables),
   * [§2.1.9.1.7](https://hl7.org/fhir/R5/fhirpath.html#vars)). A host variable of the same name
   * takes precedence.
   */
  readonly environment: EnvironmentLookup;
  /**
   * FHIR's rules for `~` on complex values: `id` elements are ignored, a `Coding` compares by
   * `system` and `code`, and a `CodeableConcept` by its codings
   * ([R5 §2.1.9.1.6](https://hl7.org/fhir/R5/fhirpath.html#changes)). The equivalence kernels read
   * it from here; undefined leaves the default rule of all child properties.
   */
  readonly modelEquivalence: ModelEquivalence | undefined;
  /** The model, or undefined for model-less evaluation of plain JSON. */
  readonly model: ModelProvider | undefined;
  /**
   * Whether navigation accepts a choice element written with its type suffix
   * (`Observation.valueQuantity`): the `lenient.choiceSuffix` compile option
   * ([ADR-0012](https://github.com/losol/callis/blob/main/docs/adr/0012-evaluation-defaults.md)).
   */
  readonly lenientChoiceSuffix: boolean;
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
  /** Receives the output of `trace()`; undefined when the host has no `trace` hook. */
  readonly trace: TraceSink | undefined;
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
