/**
 * Function arguments: compiled once by the kind of their parameter, and passed to the function on
 * each call ([T0008: compiling to closures](https://github.com/losol/callis/blob/main/docs/tasks/T0008-compiler-evaluator.md#compiling-to-closures)).
 *
 * Higher-order functions receive their lambda arguments as closures, not as values, together with
 * the frame of the call. A lambda evaluated for an item gets a new frame pointing to that frame,
 * so nested lambdas see their own `$this` and `$index`.
 */

import type { Arg, LambdaArg, TypeArg } from '../functions/define.ts';
import type { Collection, Item } from '../runtime/collection.ts';
import { type EvalContext, type Evaluator, type Frame, itemFrame } from '../runtime/context.ts';
import { type MaybePromise, mapSequential } from '../runtime/maybe-promise.ts';

/** A compiled argument. */
export type CompiledArg =
  | { readonly kind: 'value'; readonly evaluate: Evaluator }
  | { readonly kind: 'lambda'; readonly evaluate: Evaluator }
  | { readonly kind: 'type'; readonly arg: TypeArg };

const NO_ARGS: readonly Arg[] = Object.freeze([]);

/**
 * The arguments of one call. Value arguments are evaluated in order with the focus of the call,
 * each after the previous one is done; lambda arguments are bound to the call; type arguments
 * were resolved at compile time.
 */
export function evaluateArgs(
  args: readonly CompiledArg[],
  ctx: EvalContext,
  focus: Collection,
  frame: Frame,
): MaybePromise<readonly Arg[]> {
  if (args.length === 0) {
    return NO_ARGS;
  }
  return mapSequential(args, (arg): MaybePromise<Arg> => {
    switch (arg.kind) {
      case 'value':
        return arg.evaluate(ctx, focus, frame);
      case 'lambda':
        return bindLambda(arg.evaluate, ctx, focus, frame);
      case 'type':
        return arg.arg;
    }
  });
}

/**
 * Binds a compiled lambda to a call: `forItem()` evaluates it with one item as the focus, `$this`
 * and `$index`; `inPlace()` evaluates it where the call is written.
 */
export function bindLambda(
  body: Evaluator,
  ctx: EvalContext,
  focus: Collection,
  frame: Frame,
): LambdaArg {
  return {
    kind: 'lambda',
    forItem(item: Item, index: number, total?: Collection): MaybePromise<Collection> {
      const itemFocus: readonly [Item] = [item];
      return body(ctx, itemFocus, itemFrame(frame, itemFocus, index, total));
    },
    inPlace(): MaybePromise<Collection> {
      return body(ctx, focus, frame);
    },
  };
}
