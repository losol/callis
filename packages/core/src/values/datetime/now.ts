/**
 * The per-evaluation snapshot behind `now()`, `today()` and `timeOfDay()`, which must return the
 * same value every time they are called within one evaluation.
 *
 * @see https://hl7.org/fhirpath/N1/#current-date-and-time-functions
 */
import { FhirPathEvaluationError } from '../../errors/fhirpath-error.ts';
import {
  civilFromDays,
  isValidOffset,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
} from './calendar.ts';
import type { DateValue } from './date.ts';
import { DateTimeValue } from './datetime.ts';
import { TimeValue } from './time.ts';

/** The current date and time of one evaluation, in the evaluation's timezone offset. */
export interface NowSnapshot {
  /** The result of `now()`: millisecond precision, with the offset. */
  readonly now: DateTimeValue;
  /** The result of `today()`: the date at that offset. */
  readonly today: DateValue;
  /** The result of `timeOfDay()`: the time of day at that offset. */
  readonly timeOfDay: TimeValue;
}

/**
 * Resolves the `timezoneOffset` evaluation option to minutes east of UTC. The default is 0 (UTC);
 * `'local'` uses the host's offset at the instant `at`, normally the evaluation's `now`. This is
 * the only place where Callis reads the host's timezone.
 *
 * @throws FhirPathEvaluationError `eval/invalid-argument` if the offset is not a whole number of
 * minutes within ±14:00.
 * @see https://github.com/losol/callis/blob/main/docs/adr/0012-evaluation-defaults.md
 */
export function resolveTimezoneOffset(option: number | 'local' | undefined, at: Date): number {
  if (option === undefined) {
    return 0;
  }
  // `0 - x` avoids a negative zero when the host is at UTC.
  const offset = option === 'local' ? 0 - Math.round(at.getTimezoneOffset()) : option;
  if (!isValidOffset(offset)) {
    throw invalidOffset();
  }
  return offset;
}

/**
 * Takes the snapshot for one evaluation: the instant `at`, seen at `offsetMinutes` east of UTC.
 * With the default offset 0, `now()` is in UTC and `today()` is the UTC date.
 *
 * @throws FhirPathEvaluationError `eval/invalid-argument` if `at` is an invalid `Date` or the
 * offset is not a whole number of minutes within ±14:00.
 * @throws FhirPathEvaluationError `eval/datetime-out-of-range` if `at` is outside the years
 * 0001–9999 at that offset.
 */
export function takeNowSnapshot(at: Date, offsetMinutes: number): NowSnapshot {
  if (!isValidOffset(offsetMinutes)) {
    throw invalidOffset();
  }
  const instant = at.getTime();
  if (Number.isNaN(instant)) {
    throw new FhirPathEvaluationError('eval/invalid-argument', 'Expected a valid Date for now');
  }
  const local = instant + offsetMinutes * MS_PER_MINUTE;
  const days = Math.floor(local / MS_PER_DAY);
  const time = local - days * MS_PER_DAY;
  const hour = Math.floor(time / MS_PER_HOUR);
  const minute = Math.floor(time / MS_PER_MINUTE) % 60;
  const second = Math.floor(time / MS_PER_SECOND) % 60;
  const millisecond = time % MS_PER_SECOND;
  const now = DateTimeValue.tryCreate({
    ...civilFromDays(days),
    hour,
    minute,
    second,
    millisecond,
    offsetMinutes,
  });
  if (now === undefined) {
    throw new FhirPathEvaluationError(
      'eval/datetime-out-of-range',
      'Expected the current time to be between the years 0001 and 9999',
    );
  }
  return {
    now,
    today: now.toDateValue(),
    timeOfDay: TimeValue.create({ hour, minute, second, millisecond }),
  };
}

function invalidOffset(): FhirPathEvaluationError {
  return new FhirPathEvaluationError(
    'eval/invalid-argument',
    'Expected a timezone offset in whole minutes within ±14:00',
  );
}
