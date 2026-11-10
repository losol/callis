/**
 * Cancellation of an evaluation
 * ([T0021: sync and async](https://github.com/losol/callis/blob/main/docs/tasks/T0021-hooks-async.md#sync-and-async)).
 *
 * The host passes a signal with the `signal` evaluation option and receives the same object in
 * the context of every hook call, so it can hand its `AbortSignal` on to `fetch()`. The engine
 * reads the signal where an abort can first be observed: when the evaluation starts, before each
 * hook call, and after each host result it waited for. JavaScript runs an evaluation's own code
 * without interruption, so a signal can only change while the evaluation waits for a host; a
 * check inside a synchronous loop would never see anything new.
 */
import { FhirPathEvaluationError } from '../errors/fhirpath-error.ts';

/**
 * The structural subset of `AbortSignal` that an evaluation reads. Any `AbortSignal` satisfies
 * it, and so does a plain object, so `@callis/core` needs no host typings.
 *
 * @example
 * ```ts
 * const controller = new AbortController();
 * const pending = compiled.evaluateAsync(bundle, { hooks, signal: controller.signal });
 * controller.abort(); // pending rejects with eval/aborted at the next hook call
 * ```
 */
export interface CancellationSignal {
  /** Whether the host asked the evaluation to stop. */
  readonly aborted: boolean;
  /** Why it asked, if it said: `AbortSignal.reason`. It becomes the `cause` of the error. */
  readonly reason?: unknown;
}

/**
 * Stops the evaluation when the signal is aborted.
 *
 * @throws {@link FhirPathEvaluationError} `eval/aborted`, with the signal's `reason` as its
 *   `cause`, when the signal is aborted.
 */
export function throwIfAborted(signal: CancellationSignal | undefined): void {
  if (signal !== undefined && signal.aborted === true) {
    throw new FhirPathEvaluationError('eval/aborted', 'The evaluation was aborted by its signal', {
      cause: signal.reason,
    });
  }
}
