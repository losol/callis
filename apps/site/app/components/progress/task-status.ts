import type { TaskStatus } from '../../../progress/state.ts';

/** The mark of each status on the board, as in a Markdown task list. */
export const STATUS_MARK: Readonly<Record<TaskStatus, string>> = {
  done: '[x]',
  ready: '[>]',
  blocked: '[ ]',
};

/** Each status in words, as the legend names it. */
export const STATUS_NAME: Readonly<Record<TaskStatus, string>> = {
  done: 'merged',
  ready: 'unblocked',
  blocked: 'blocked',
};
