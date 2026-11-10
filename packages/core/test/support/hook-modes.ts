/**
 * Runs hook-backed cases in sync and async mode ([ADR-0004](../../../docs/adr/0004-sync-core-async-path.md)):
 * `MODES` evaluates with `evaluate()` or `evaluateAsync()`, and `hooksFor()` makes every hook
 * answer through a promise in async mode, so one table of cases covers both paths.
 */
import {
  type CompileOptions,
  type EvaluateOptions,
  evaluate,
  evaluateAsync,
} from '../../src/api/compile.ts';
import type {
  CodedValue,
  Coding,
  EvaluationHooks,
  HookContext,
  HtmlChecksContext,
  ResolveContext,
} from '../../src/runtime/hooks.ts';

/** A mode: its label, how it evaluates, and whether its hooks answer asynchronously. */
export type Mode = readonly [
  label: string,
  run: (
    input: unknown,
    expression: string,
    options?: CompileOptions & EvaluateOptions,
  ) => Promise<unknown[]>,
  isAsync: boolean,
];

/** Sync and async mode. */
export const MODES: readonly Mode[] = [
  [
    'in sync mode',
    async (input, expression, options) => evaluate(input, expression, options),
    false,
  ],
  [
    'in async mode',
    (input, expression, options) => evaluateAsync(input, expression, options),
    true,
  ],
];

/** The hooks as they are, or in async mode with every answer wrapped in a promise. */
export function hooksFor(hooks: EvaluationHooks, isAsync: boolean): EvaluationHooks {
  if (!isAsync) {
    return hooks;
  }
  const terminology = hooks.terminology;
  return {
    ...(hooks.resolve === undefined
      ? {}
      : {
          resolve: (reference: string, context: ResolveContext) =>
            Promise.resolve(hooks.resolve?.(reference, context)),
        }),
    ...(hooks.conformsTo === undefined
      ? {}
      : {
          conformsTo: (value: unknown, profile: string, context: HookContext) =>
            Promise.resolve(hooks.conformsTo?.(value, profile, context)),
        }),
    ...(hooks.htmlChecks === undefined
      ? {}
      : {
          htmlChecks: (html: string, context: HtmlChecksContext) =>
            Promise.resolve(hooks.htmlChecks?.(html, context)),
        }),
    ...(hooks.trace === undefined ? {} : { trace: hooks.trace }),
    ...(hooks.regex === undefined ? {} : { regex: hooks.regex }),
    ...(terminology === undefined
      ? {}
      : {
          terminology: {
            ...(terminology.memberOf === undefined
              ? {}
              : {
                  memberOf: (coded: CodedValue, valueSet: string, context: HookContext) =>
                    Promise.resolve(terminology.memberOf?.(coded, valueSet, context)),
                }),
            ...(terminology.subsumes === undefined
              ? {}
              : {
                  subsumes: (a: Coding, b: Coding, context: HookContext) =>
                    Promise.resolve(terminology.subsumes?.(a, b, context)),
                }),
          },
        }),
  };
}
