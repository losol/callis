/**
 * The host hooks of an evaluation
 * ([T0021: host hooks](https://github.com/losol/callis/blob/main/docs/tasks/T0021-hooks-async.md#host-hooks),
 * [ADR-0004](https://github.com/losol/callis/blob/main/docs/adr/0004-sync-core-async-path.md)).
 *
 * Hosts plug in what needs I/O or a policy of their own: resolving references, terminology,
 * profile validation, HTML checks, a safe regular-expression engine, and where `trace()` writes.
 * Every hook is optional. Without one, the function that needs it gives empty and never throws;
 * with one, the function gives what the hook answers, and empty where the hook answers
 * `undefined`. An error the hook throws, or a rejection, ends the evaluation as it is: a host
 * that wants a FHIRPath error with a stable code throws a `FhirPathEvaluationError`.
 *
 * Every hook except `regex` may return a promise, or any other thenable, in `evaluateAsync()`;
 * in `evaluate()` a thenable raises `eval/async-in-sync` ({@link adoptResult}). Hooks know
 * nothing about FHIR versions: a resource a `resolve` hook returns is typed by the evaluation's
 * model like the input.
 *
 * The contracts live in `runtime`, as `UnitSystem` lives in `values`, because the FHIR functions
 * and the compiler consume them. The API validates the host's object and binds it to one
 * evaluation ({@link bindHooks}), so the functions call a {@link BoundHooks} member and never see
 * a thenable in sync mode.
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';
import type { SourceSpan } from '../errors/source-span.ts';
import { type CancellationSignal, throwIfAborted } from './cancellation.ts';
import { adoptResult, andThen, type MaybePromise } from './maybe-promise.ts';

/** What a hook returns: the value, or a promise or any other thenable of it. */
export type HookResult<T> = T | PromiseLike<T>;

/** What every hook call receives besides its arguments. */
export interface HookContext {
  /**
   * The `signal` option of the evaluation, the same object the host passed, so a hook can hand
   * its `AbortSignal` on to `fetch()`; undefined when the host gave none.
   */
  readonly signal: CancellationSignal | undefined;
}

/** The context of a `resolve` hook call. */
export interface ResolveContext extends HookContext {
  /**
   * The JSON of the resource the reference is part of, when it is part of one, so a host can
   * take a relative reference against that resource's base. Undefined for a reference that is
   * part of no resource, such as a String literal.
   */
  readonly resource: unknown;
}

/** A code with its system, as in a FHIR `Coding`; every element is optional in the data too. */
export interface Coding {
  readonly system?: string;
  readonly version?: string;
  readonly code?: string;
  readonly display?: string;
}

/** The input of `memberOf()`, as the terminology provider receives it. */
export interface CodedValue {
  /** What the input item is: a `code` or String, a `Coding` or a `CodeableConcept`. */
  readonly kind: 'code' | 'Coding' | 'CodeableConcept';
  /**
   * The codings to test: one for a `Coding`, those of a `CodeableConcept`, and for a `code` or
   * String one coding with only a `code`, since the data names no system.
   */
  readonly codings: readonly Coding[];
  /** The JSON of the input item: the string, or the `Coding` or `CodeableConcept` object. */
  readonly value: unknown;
}

/**
 * How one coding relates to another, as the FHIR
 * [`$subsumes`](https://hl7.org/fhir/R5/codesystem-operation-subsumes.html) operation reports it:
 * the first coding is equivalent to the second, subsumes it, is subsumed by it, or neither.
 */
export type SubsumptionOutcome = 'equivalent' | 'subsumes' | 'subsumed-by' | 'not-subsumed';

/**
 * Backs `memberOf()`, `subsumes()` and `subsumedBy()`; T0032 extends it with the operations of
 * `%terminologies`. Each member is optional, and a function without its member gives empty.
 */
export interface TerminologyProvider {
  /**
   * Whether the coded value is in the value set with the canonical URL `valueSet`: true, false,
   * or undefined when the provider cannot tell, for example for a value set it does not know,
   * which makes `memberOf()` empty. Throw to raise an error instead.
   */
  memberOf?(
    coded: CodedValue,
    valueSet: string,
    context: HookContext,
  ): HookResult<boolean | undefined>;
  /**
   * How coding `a` relates to coding `b`, or undefined when the provider cannot tell, for
   * example for codings of different systems with no defined relationship, which makes
   * `subsumes()` and `subsumedBy()` empty. Throw to raise an error instead. Two codings with the
   * same system and code are equivalent without a call.
   */
  subsumes?(a: Coding, b: Coding, context: HookContext): HookResult<SubsumptionOutcome | undefined>;
}

/** The context of an `htmlChecks` hook call. */
export interface HtmlChecksContext extends HookContext {
  /**
   * What the text is: the `xhtml` element itself, a `div`, for a node the model types as `xhtml`;
   * or a string, the content of a `div`, for any other string, including an untyped `text.div`
   * evaluated without a model.
   */
  readonly kind: 'xhtml' | 'string';
}

/**
 * A compiled regular expression, as the `regex` hook returns it: the part of `RegExp` that
 * `matches()` and `replaceMatches()` use. A `RegExp` compiled without the `g` flag satisfies
 * `test()`; `matchAll()` is written by the host.
 */
export interface RegexMatcher {
  /** Whether the text has a match. */
  test(text: string): boolean;
  /**
   * Every match in the text from the start, without overlap, as `String.prototype.matchAll()`
   * yields them: the matched text at `0`, the groups at `1`…, `index` and the named `groups`.
   */
  matchAll(text: string): Iterable<RegExpMatchArray>;
}

/**
 * One call of `trace()`
 * ([N1 §5.9.1](https://hl7.org/fhirpath/N1/#tracename-string-projection-expression-collection)).
 */
export interface TraceEvent {
  /** The `name` argument. */
  readonly name: string;
  /**
   * The traced collection, converted like a result of the evaluation (`output` and
   * `decimalOutput`): the input of `trace()`, or the result of its projection.
   */
  readonly values: readonly unknown[];
  /** Where the call is in the expression. */
  readonly span: SourceSpan;
}

/**
 * Functions the host supplies for one evaluation, with the `hooks` option. The engine calls them
 * with the hooks object as `this`, and a terminology member with the provider as `this`.
 */
export interface EvaluationHooks {
  /**
   * Backs `resolve()` for a reference that is not in the data: the `reference` of a `Reference`,
   * or a String, `uri`, `url` or `canonical` value. It returns the resource as JSON, which the
   * evaluation's model types like the input, or undefined or `null` for a reference that does not
   * resolve. `resolve()` first looks in the data, for contained resources (`#id`) and the entries
   * of the Bundle around the reference, and asks the hook only for the rest.
   */
  resolve?(reference: string, context: ResolveContext): HookResult<unknown>;
  /** Backs `memberOf()`, `subsumes()` and `subsumedBy()`; later `%terminologies` (T0032). */
  readonly terminology?: TerminologyProvider;
  /**
   * Backs `conformsTo()`: whether `value`, the JSON of the single input item, conforms to the
   * profile with the canonical URL `profile`. Undefined makes `conformsTo()` empty, as the R5 and
   * R6 texts ask for a profile that cannot be resolved; a host that follows the R4 text and the
   * HL7 suites raises an error for it instead, by throwing.
   */
  conformsTo?(
    value: unknown,
    profile: string,
    context: HookContext,
  ): HookResult<boolean | undefined>;
  /**
   * Backs `htmlChecks()`: whether `html` follows FHIR's rules for narrative XHTML. It is the
   * `xhtml` element itself or the content of a `div`; `context.kind` says which.
   */
  htmlChecks?(html: string, context: HtmlChecksContext): HookResult<boolean | undefined>;
  /**
   * Compiles the regular expressions of `matches()` and `replaceMatches()`, for a host that
   * wants a safe engine instead of JavaScript's backtracking `RegExp`. It is synchronous. The
   * flags are the ones Callis always uses, `su`, never `g`: the matcher's `matchAll()` finds every
   * match by itself. A `SyntaxError` it throws is reported as an invalid pattern,
   * `eval/invalid-argument`, like one from `RegExp`.
   */
  regex?(pattern: string, flags: string): RegexMatcher;
  /**
   * Receives the output of `trace()`, in evaluation order; without it, `trace()` only returns its
   * input. It may return a promise in `evaluateAsync()`, which the evaluation waits for before it
   * goes on; in `evaluate()` a promise raises `eval/async-in-sync`. An error it throws ends the
   * evaluation ([spec notes](https://github.com/losol/callis/blob/main/docs/spec-notes.md#trace-names-and-projections)).
   */
  trace?(event: TraceEvent): void | PromiseLike<void>;
}

/**
 * The hooks of one evaluation as the functions call them: validated, bound to the host's objects,
 * and guarded. Each call reads the signal first, rejects a thenable in sync mode, adopts it in
 * async mode and reads the signal again once the result has arrived, and checks the result's
 * type. A hook the host did not give is undefined. The `trace` hook is bound by the API, which
 * converts the traced values, and is `EvalContext.trace`.
 */
export interface BoundHooks {
  readonly resolve:
    | ((reference: string, context: ResolveContext) => MaybePromise<unknown>)
    | undefined;
  readonly memberOf:
    | ((
        coded: CodedValue,
        valueSet: string,
        context: HookContext,
      ) => MaybePromise<boolean | undefined>)
    | undefined;
  readonly subsumes:
    | ((a: Coding, b: Coding, context: HookContext) => MaybePromise<SubsumptionOutcome | undefined>)
    | undefined;
  readonly conformsTo:
    | ((value: unknown, profile: string, context: HookContext) => MaybePromise<boolean | undefined>)
    | undefined;
  readonly htmlChecks:
    | ((html: string, context: HtmlChecksContext) => MaybePromise<boolean | undefined>)
    | undefined;
  readonly regex: ((pattern: string, flags: string) => RegexMatcher) | undefined;
}

/** The bound hooks of an evaluation without any. */
export const NO_HOOKS: BoundHooks = Object.freeze({
  resolve: undefined,
  memberOf: undefined,
  subsumes: undefined,
  conformsTo: undefined,
  htmlChecks: undefined,
  regex: undefined,
});

/** What binding needs to know about the evaluation. */
export interface HookBinding {
  /** Whether this is an `evaluateAsync()` evaluation, where a hook may return a thenable. */
  readonly isAsync: boolean;
  /** The evaluation's cancellation signal, if the host gave one. */
  readonly signal: CancellationSignal | undefined;
}

/**
 * Validates the host's `hooks` option and binds every hook but `trace` to an evaluation.
 *
 * @throws {@link FhirPathEvaluationError} `eval/invalid-argument` when `hooks` is not an object,
 *   a hook is not a function, or `terminology` is not an object.
 */
export function bindHooks(hooks: EvaluationHooks | undefined, binding: HookBinding): BoundHooks {
  if (hooks === undefined) {
    return NO_HOOKS;
  }
  if (typeof hooks !== 'object' || hooks === null) {
    throw invalid('Expected hooks to be an object');
  }
  const terminology = hooks.terminology;
  if (terminology !== undefined && (typeof terminology !== 'object' || terminology === null)) {
    throw invalid('Expected the terminology hook to be an object');
  }
  const resolve = asHook(hooks.resolve, 'resolve');
  const memberOf = asHook(terminology?.memberOf, 'terminology.memberOf');
  const subsumes = asHook(terminology?.subsumes, 'terminology.subsumes');
  const conformsTo = asHook(hooks.conformsTo, 'conformsTo');
  const htmlChecks = asHook(hooks.htmlChecks, 'htmlChecks');
  const regex = asHook(hooks.regex, 'regex');
  asHook(hooks.trace, 'trace');
  const provider: object = terminology ?? hooks;
  const bound: BoundHooks = {
    resolve:
      resolve === undefined
        ? undefined
        : (reference, context) =>
            callHook(binding, () => resolve.call(hooks, reference, context), identity),
    memberOf:
      memberOf === undefined
        ? undefined
        : (coded, valueSet, context) =>
            callHook(
              binding,
              () => memberOf.call(provider, coded, valueSet, context),
              booleanResult('terminology.memberOf'),
            ),
    subsumes:
      subsumes === undefined
        ? undefined
        : (a, b, context) =>
            callHook(binding, () => subsumes.call(provider, a, b, context), outcomeResult),
    conformsTo:
      conformsTo === undefined
        ? undefined
        : (value, profile, context) =>
            callHook(
              binding,
              () => conformsTo.call(hooks, value, profile, context),
              booleanResult('conformsTo'),
            ),
    htmlChecks:
      htmlChecks === undefined
        ? undefined
        : (html, context) =>
            callHook(
              binding,
              () => htmlChecks.call(hooks, html, context),
              booleanResult('htmlChecks'),
            ),
    regex:
      regex === undefined
        ? undefined
        : (pattern, flags) => matcherResult(regex.call(hooks, pattern, flags)),
  };
  return Object.freeze(bound);
}

/** The hook, checked to be a function when it is given at all. */
function asHook<T extends (...args: never[]) => unknown>(
  hook: T | undefined,
  name: string,
): T | undefined {
  if (hook !== undefined && typeof hook !== 'function') {
    throw invalid(`Expected the ${name} hook to be a function`);
  }
  return hook;
}

/** One guarded hook call: the signal, the sync/async boundary, the signal again, the result check. */
function callHook<T, R>(
  binding: HookBinding,
  call: () => HookResult<T>,
  check: (result: T) => R,
): MaybePromise<R> {
  throwIfAborted(binding.signal);
  return andThen(adoptResult(call(), binding.isAsync, binding.signal), check);
}

function identity(value: unknown): unknown {
  return value;
}

function booleanResult(name: string): (result: boolean | undefined) => boolean | undefined {
  return (result: unknown) => {
    if (result === undefined || result === null) {
      return undefined;
    }
    if (typeof result === 'boolean') {
      return result;
    }
    throw invalid(`Expected the ${name} hook to return a boolean or undefined`);
  };
}

const OUTCOMES: readonly string[] = ['equivalent', 'subsumes', 'subsumed-by', 'not-subsumed'];

function outcomeResult(result: unknown): SubsumptionOutcome | undefined {
  if (result === undefined || result === null) {
    return undefined;
  }
  if (typeof result === 'string' && OUTCOMES.includes(result)) {
    return result as SubsumptionOutcome;
  }
  throw invalid(
    'Expected the terminology.subsumes hook to return equivalent, subsumes, subsumed-by, not-subsumed or undefined',
  );
}

function matcherResult(result: unknown): RegexMatcher {
  if (
    typeof result === 'object' &&
    result !== null &&
    typeof (result as { readonly test?: unknown }).test === 'function' &&
    typeof (result as { readonly matchAll?: unknown }).matchAll === 'function'
  ) {
    return result as RegexMatcher;
  }
  throw invalid('Expected the regex hook to return a matcher with test() and matchAll()');
}

function invalid(message: string): FhirPathEvaluationError {
  return new FhirPathEvaluationError('eval/invalid-argument', message);
}
