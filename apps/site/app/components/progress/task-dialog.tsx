import { type ReactNode, useEffect, useId, useRef } from 'react';
import { Link } from 'react-router';

import { dependentsOf, statusAt, waitingForAt } from '../../../progress/state.ts';
import type { CommitPoint, GoalBlock, PlanTask } from '../../../progress/types.ts';
import type { DocLink } from '../../doc-links.ts';
import { site } from '../../site.config.ts';
import { STATUS_MARK, STATUS_NAME } from './task-status.ts';

export interface TaskDialogProps {
  /** The task to show, or null for a closed dialog. */
  task: PlanTask | null;
  plan: readonly PlanTask[];
  commits: readonly CommitPoint[];
  /** The selected commit; the status is the status at this commit. */
  active: number;
  /** Where the task file is read, if anywhere. */
  page: DocLink | undefined;
  /** Shows another task, by ID, in the same dialog. */
  onShow: (id: string) => void;
  /** Called after the dialog closed, whether by Escape, the close button or the backdrop. */
  onClose: () => void;
}

/**
 * The details of a roadmap task in a modal `<dialog>`. The browser makes the
 * rest of the page inert while it is open and closes it on Escape; a click on
 * the backdrop closes it too. The focus goes to the title when it opens and when
 * it switches to another task, so a screen reader reads the task out.
 */
export function TaskDialog({
  task,
  plan,
  commits,
  active,
  page,
  onShow,
  onClose,
}: TaskDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();
  const taskId = task?.id ?? null;

  useEffect(() => {
    const element = dialog.current;
    if (element === null) {
      return;
    }
    if (taskId === null) {
      if (element.open) {
        element.close();
      }
      return;
    }
    if (!element.open) {
      element.showModal();
    }
    heading.current?.focus();
  }, [taskId]);

  const close = () => dialog.current?.close();
  const mergedPr = task?.doneAt != null ? (commits[task.doneAt]?.pr ?? null) : null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click only adds the backdrop; Escape, handled by the browser, is the keyboard equivalent
    <dialog
      ref={dialog}
      className="pg-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onPointerDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // The dialog has no padding, so a click on the dialog itself is a click on the backdrop.
        // A press that started inside (selecting text, say) does not count.
        if (pressedOnBackdrop.current && event.target === event.currentTarget) {
          close();
        }
        pressedOnBackdrop.current = false;
      }}
    >
      {task !== null && (
        <div className="pg-dialog-body">
          <div className="pg-dialog-head">
            <h2 id={titleId} ref={heading} tabIndex={-1}>
              <span className="pg-dialog-id">{task.id}</span>
              <span className="pg-dialog-title">
                <Inline text={task.title} />
              </span>
            </h2>
            <button type="button" className="pg-dialog-close" onClick={close}>
              <span aria-hidden="true">✕</span>
              <span className="pg-visually-hidden">Close</span>
            </button>
          </div>

          <Status task={task} plan={plan} commits={commits} active={active} />

          <dl className="pg-facts">
            <div>
              <dt>Wave</dt>
              <dd>{task.wave}</dd>
            </div>
            <div>
              <dt>Phase</dt>
              <dd>{task.phase}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{task.size}</dd>
            </div>
          </dl>

          {task.goal.length > 0 && (
            <section className="pg-dialog-section" aria-labelledby={`${titleId}-goal`}>
              <h3 id={`${titleId}-goal`}>Goal</h3>
              <Goal blocks={task.goal} />
            </section>
          )}

          <Relations
            id={`${titleId}-deps`}
            heading="Depends on"
            empty="Nothing: it can start at any time."
            ids={task.deps}
            plan={plan}
            active={active}
            onShow={onShow}
          />
          <Relations
            id={`${titleId}-dependents`}
            heading="Needed by"
            empty="No task depends on it."
            ids={dependentsOf(plan, task).map((dependent) => dependent.id)}
            plan={plan}
            active={active}
            onShow={onShow}
          />

          <ul className="pg-dialog-links">
            {page !== undefined && (
              <li>
                {page.external ? (
                  <ExternalLink href={page.href}>Task file</ExternalLink>
                ) : (
                  <Link to={page.href}>Task file</Link>
                )}
              </li>
            )}
            <li>
              <ExternalLink href={issueSearchUrl(task.id)}>GitHub issue</ExternalLink>
            </li>
            {mergedPr !== null && (
              <li>
                <ExternalLink href={`${site.githubUrl}/pull/${mergedPr}`}>
                  {`Pull request #${mergedPr}`}
                </ExternalLink>
              </li>
            )}
          </ul>
        </div>
      )}
    </dialog>
  );
}

/**
 * The GitHub search for a task's issue. The roadmap sync titles every task issue
 * `T0001: …` and labels it `task`, but the issue number is only known to GitHub.
 */
export function issueSearchUrl(id: string): string {
  const query = `is:issue label:task in:title "${id}:"`;
  return `${site.githubUrl}/issues?q=${encodeURIComponent(query)}`;
}

function Status({
  task,
  plan,
  commits,
  active,
}: {
  task: PlanTask;
  plan: readonly PlanTask[];
  commits: readonly CommitPoint[];
  active: number;
}) {
  const status = statusAt(plan, task, active);
  const at = commits[active]?.sha.slice(0, 7) ?? '';
  let detail: string;
  if (status === 'done') {
    const merged = commits[task.doneAt ?? 0];
    detail = merged
      ? `in ${merged.pr ? `#${merged.pr}` : merged.sha.slice(0, 7)} on ${merged.date}.`
      : '.';
  } else if (status === 'ready') {
    detail =
      task.deps.length === 0
        ? `at ${at}: it depends on no other task.`
        : `at ${at}: every dependency is merged.`;
  } else {
    detail = `at ${at}: waiting for ${waitingForAt(plan, task, active).join(', ')}.`;
  }
  return (
    <p className="pg-dialog-status">
      <span className={`pg-badge ${status}`}>
        <span aria-hidden="true">{`${STATUS_MARK[status]} `}</span>
        {capitalize(STATUS_NAME[status])}
      </span>
      {` ${detail}`}
    </p>
  );
}

function Relations({
  id,
  heading,
  empty,
  ids,
  plan,
  active,
  onShow,
}: {
  id: string;
  heading: string;
  empty: string;
  ids: readonly string[];
  plan: readonly PlanTask[];
  active: number;
  onShow: (id: string) => void;
}) {
  return (
    <section className="pg-dialog-section" aria-labelledby={id}>
      <h3 id={id}>{ids.length > 0 ? `${heading} (${ids.length})` : heading}</h3>
      {ids.length === 0 ? (
        <p className="pg-dialog-empty">{empty}</p>
      ) : (
        <ul className="pg-relations">
          {ids.map((relatedId) => {
            const related = plan.find((candidate) => candidate.id === relatedId);
            if (related === undefined) {
              return (
                <li key={relatedId}>
                  <span className="pg-relation blocked">
                    <span className="pg-relation-id">{relatedId}</span>
                    <span className="pg-relation-title">not in the roadmap</span>
                  </span>
                </li>
              );
            }
            const status = statusAt(plan, related, active);
            return (
              <li key={relatedId}>
                <button
                  type="button"
                  className={`pg-relation ${status}`}
                  onClick={() => onShow(relatedId)}
                >
                  <span className="pg-relation-mark" aria-hidden="true">
                    {STATUS_MARK[status]}
                  </span>
                  <span className="pg-relation-id">{related.id}</span>
                  <span className="pg-relation-title">
                    <Inline text={related.title} />
                  </span>
                  <span className="pg-visually-hidden">{`(${STATUS_NAME[status]})`}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Paragraphs as paragraphs, and each run of list items as one list. */
function Goal({ blocks }: { blocks: readonly GoalBlock[] }) {
  type Group = { key: string; kind: GoalBlock['kind']; blocks: { key: string; text: string }[] };
  const groups: Group[] = [];
  blocks.forEach((block, position) => {
    const entry = { key: `${position}`, text: block.text };
    const last = groups.at(-1);
    if (block.kind === 'item' && last?.kind === 'item') {
      last.blocks.push(entry);
    } else {
      groups.push({ key: entry.key, kind: block.kind, blocks: [entry] });
    }
  });
  return groups.map((group) =>
    group.kind === 'paragraph' ? (
      <p key={group.key}>
        <Inline text={group.blocks.map((entry) => entry.text).join(' ')} />
      </p>
    ) : (
      <ul key={group.key}>
        {group.blocks.map((entry) => (
          <li key={entry.key}>
            <Inline text={entry.text} />
          </li>
        ))}
      </ul>
    ),
  );
}

/** Text with its `code` spans shown as code. Everything is rendered as text, never as markup. */
function Inline({ text }: { text: string }) {
  const parts: { key: string; code: boolean; text: string }[] = [];
  let offset = 0;
  for (const part of text.split(/(`[^`]+`)/)) {
    if (part !== '') {
      const code = part.length > 2 && part.startsWith('`') && part.endsWith('`');
      parts.push({ key: `${offset}`, code, text: code ? part.slice(1, -1) : part });
    }
    offset += part.length;
  }
  return parts.map((part) =>
    part.code ? <code key={part.key}>{part.text}</code> : <span key={part.key}>{part.text}</span>,
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span aria-hidden="true"> ↗</span>
      <span className="pg-visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
