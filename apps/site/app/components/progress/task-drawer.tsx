import { type ReactNode, useEffect, useId, useRef } from 'react';
import { Link } from 'react-router';

import { dependentsOf, statusAt, waitingForAt } from '../../../progress/state.ts';
import type { CommitPoint, GoalBlock, PlanTask } from '../../../progress/types.ts';
import type { DocLink } from '../../doc-links.ts';
import { site } from '../../site.config.ts';
import { STATUS_MARK, STATUS_NAME } from './task-status.ts';

export interface TaskDrawerProps {
  /** The task to show. */
  task: PlanTask;
  plan: readonly PlanTask[];
  commits: readonly CommitPoint[];
  /** The selected commit; the status is the status at this commit. */
  active: number;
  /** Where the task file is read, if anywhere. */
  page: DocLink | undefined;
  /**
   * Counts the requests to move the focus into the drawer. The focus moves to
   * the title whenever it changes: when the drawer opens and when it switches
   * to another task.
   */
  focusRequest: number;
  /** Shows another task, by ID, in the drawer. */
  onShow: (id: string) => void;
  /** Asks to close the drawer, by Escape or the close button. */
  onClose: () => void;
}

/**
 * When the drawer is this wide, it covers the whole page below the site header.
 * Keep it in step with the full-width breakpoint of `.pg-drawer` in progress.css.
 */
const COVERS_PAGE = '(max-width: 40rem)';

/**
 * Makes everything inside `root` inert except `element` and its ancestors, and
 * returns a function that undoes it. Elements that were inert already are left
 * alone.
 */
function makeInertAround(element: HTMLElement, root: HTMLElement): () => void {
  const changed: HTMLElement[] = [];
  let node = element;
  while (node !== root && node.parentElement !== null) {
    for (const sibling of node.parentElement.children) {
      if (sibling !== node && sibling instanceof HTMLElement && !sibling.inert) {
        sibling.inert = true;
        changed.push(sibling);
      }
    }
    node = node.parentElement;
  }
  return () => {
    for (const sibling of changed) {
      sibling.inert = false;
    }
  };
}

/**
 * The details of a roadmap task in a drawer on the right edge of the window,
 * below the site header. It is a non-modal dialog: the board stays usable next
 * to it, so the focus is not trapped, and a click on another tile shows that
 * task instead. Escape or the close button closes it. The focus goes to the
 * title when it opens and when it switches tasks, so a screen reader reads the
 * task out.
 *
 * On narrow screens the drawer covers the page below the header, so the page
 * behind it is made inert while it is open: the keyboard moves between the
 * drawer and the header, never to controls it hides.
 */
export function TaskDrawer({
  task,
  plan,
  commits,
  active,
  page,
  focusRequest,
  onShow,
  onClose,
}: TaskDrawerProps) {
  const drawer = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (focusRequest > 0) {
      heading.current?.focus();
    }
  }, [focusRequest]);

  // While the drawer covers the page, the page behind it is inert; the header is outside <main>.
  useEffect(() => {
    const element = drawer.current;
    const page = element?.closest('main');
    if (!element || !page) {
      return;
    }
    const covering = window.matchMedia(COVERS_PAGE);
    let restore: (() => void) | undefined;
    const update = () => {
      restore?.();
      restore = covering.matches ? makeInertAround(element, page) : undefined;
    };
    update();
    covering.addEventListener('change', update);
    return () => {
      covering.removeEventListener('change', update);
      restore?.();
    };
  }, []);

  const mergedPr = task.doneAt !== null ? (commits[task.doneAt]?.pr ?? null) : null;

  return (
    <section
      ref={drawer}
      className="pg-drawer"
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClose();
        }
      }}
    >
      <div className="pg-drawer-head">
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          <span className="pg-drawer-id">{task.id}</span>
          <span className="pg-drawer-title">
            <Inline text={task.title} />
          </span>
        </h2>
        <button type="button" className="pg-drawer-close" onClick={onClose}>
          <span aria-hidden="true">✕</span>
          <span className="pg-visually-hidden">Close</span>
        </button>
      </div>

      {/* Keyed by task: the drawer stays mounted when it switches tasks, and the new task starts
          at the top of a fresh body instead of keeping the old task's scroll position. */}
      <div key={task.id} className="pg-drawer-body">
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
          <section className="pg-drawer-section" aria-labelledby={`${titleId}-goal`}>
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

        <ul className="pg-drawer-links">
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
    </section>
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
    <p className="pg-drawer-status">
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
    <section className="pg-drawer-section" aria-labelledby={id}>
      <h3 id={id}>{ids.length > 0 ? `${heading} (${ids.length})` : heading}</h3>
      {ids.length === 0 ? (
        <p className="pg-drawer-empty">{empty}</p>
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
