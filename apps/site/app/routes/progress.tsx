import { useEffect, useMemo, useState } from 'react';
import { useLoaderData } from 'react-router';

import {
  itemsDoneAt,
  itemsTotal,
  passRate,
  phase1Of,
  suiteNames,
  tasksDoneAt,
} from '../../progress/state.ts';
import { Board } from '../components/progress/board.tsx';
import { LineChart } from '../components/progress/charts.tsx';
import { CommitLog } from '../components/progress/commit-log.tsx';
import { Functions } from '../components/progress/functions.tsx';
import { getProgress, getTaskPages } from '../progress.server.ts';
import progressStylesheet from './progress.css?url';

export function links() {
  return [{ rel: 'stylesheet', href: progressStylesheet }];
}

export function meta() {
  return [{ title: 'Progress · Callis' }];
}

export function loader() {
  const progress = getProgress();
  return { ...progress, taskPages: getTaskPages(progress.plan) };
}

const number = new Intl.NumberFormat('en');
const percent = (value: number) => `${Number((value * 100).toFixed(1))}%`;

/** A bar of blocks, `████░░░░`, for a share of a whole. */
function Bar({ done, total, width = 20 }: { done: number; total: number; width?: number }) {
  const filled = total === 0 ? 0 : Math.round((done / total) * width);
  return (
    <span className="pg-bar" aria-hidden="true">
      {'█'.repeat(filled)}
      <i>{'░'.repeat(width - filled)}</i>
    </span>
  );
}

/** Whether the focus is on something that uses the arrow keys itself. */
function usesArrowKeys(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
  );
}

/** Whether the focus is on something the space bar activates. */
function usesSpace(target: EventTarget | null): boolean {
  return (
    usesArrowKeys(target) ||
    (target instanceof HTMLElement && ['BUTTON', 'A'].includes(target.tagName))
  );
}

export default function ProgressPage() {
  const data = useLoaderData<typeof loader>();
  const { commits, plan } = data;
  const count = commits.length;
  const suites = useMemo(() => suiteNames(data), [data]);

  const [suite, setSuite] = useState(suites.includes('r4') ? 'r4' : (suites[0] ?? 'r4'));
  const [active, setActive] = useState(count - 1);
  const [playing, setPlaying] = useState(false);

  // Play: one commit per step, from the selected one to the last.
  useEffect(() => {
    if (!playing) {
      return;
    }
    if (active >= count - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setActive(active + 1), 900);
    return () => clearTimeout(timer);
  }, [playing, active, count]);

  const select = (index: number) => {
    setPlaying(false);
    setActive(Math.min(Math.max(index, 0), count - 1));
  };

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (active >= count - 1) {
      setActive(0);
    }
    setPlaying(true);
  };

  // The arrow keys step and the space bar plays, unless the focus is on something that uses the
  // key, or a dialog (the task details) is open and has the keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        document.querySelector('dialog[open]')
      ) {
        return;
      }
      if (event.key === 'ArrowLeft' && !usesArrowKeys(event.target)) {
        select(active - 1);
      } else if (event.key === 'ArrowRight' && !usesArrowKeys(event.target)) {
        select(active + 1);
      } else if (event.key === ' ' && !usesSpace(event.target)) {
        event.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const commit = commits[active];
  if (!commit) {
    return <main className="pg-page">No commits yet.</main>;
  }
  const totals = phase1Of(commit, suite);
  const merged = tasksDoneAt(plan, active);
  const items = itemsDoneAt(plan, active);
  const firstWithData = commits.findIndex((candidate) => passRate(candidate, suite) !== null);
  const adapter = commits[count - 1]?.conformance?.adapter;
  const functionsTotal = itemsTotal(plan);

  return (
    <main className="pg-page">
      <h1>Progress, commit by commit</h1>
      <p className="pg-lede">
        HL7 conformance, roadmap tasks, tests and source size for every commit on the main line of
        the history. Step through it with the arrow keys, the space bar or the slider.
      </p>

      <section className="pg-player" aria-label="Commit player">
        <div className="pg-player-row">
          <button type="button" onClick={() => select(0)} title="First commit">
            |◀
          </button>
          <button type="button" onClick={() => select(active - 1)} title="Previous commit (←)">
            ◀
          </button>
          <button type="button" onClick={togglePlay} title="Play or pause (space)">
            {playing ? '❚❚ pause' : '▶ play'}
          </button>
          <button type="button" onClick={() => select(active + 1)} title="Next commit (→)">
            ▶
          </button>
          <input
            type="range"
            min={0}
            max={count - 1}
            value={active}
            aria-label="Commit"
            onChange={(event) => select(Number(event.target.value))}
          />
          <span className="pg-pos">{`${active + 1}/${count}`}</span>
        </div>
        <div className="pg-now" aria-live="polite">
          <div className="pg-subject">
            {commit.pr ? `#${commit.pr}  ` : ''}
            {commit.subject}
          </div>
          <div className="pg-meta">
            {`${commit.sha.slice(0, 7)} · ${commit.date}`}
            {commit.tasks
              .filter((id) => plan.find((task) => task.id === id)?.doneAt === active)
              .map((id) => (
                <span key={id} className="pg-tag">{`${id} merged`}</span>
              ))}
          </div>
        </div>
      </section>

      <section className="pg-stats" aria-label="Numbers at the selected commit">
        <div className="pg-card">
          <div className="pg-label">Phase 1 passing</div>
          <div className="pg-value">
            {totals ? number.format(totals.passed) : '–'}
            {totals && <small>{` / ${number.format(totals.total)}`}</small>}
          </div>
          <div className="pg-hint">
            {suite.toUpperCase()} suite{totals ? '' : ', no runner yet'}
          </div>
        </div>
        <div className="pg-card">
          <div className="pg-label">Tasks merged</div>
          <div className="pg-value">
            {merged}
            <small>{` / ${plan.length}`}</small>
          </div>
          <div className="pg-hint">
            <Bar done={merged} total={plan.length} />
          </div>
        </div>
        <div className="pg-card">
          <div className="pg-label">Functions + operators</div>
          <div className="pg-value">
            {items}
            <small>{` / ${functionsTotal}`}</small>
          </div>
          <div className="pg-hint">
            <Bar done={items} total={functionsTotal} />
          </div>
        </div>
        <div className="pg-card">
          <div className="pg-label">Unit tests</div>
          <div className="pg-value">{number.format(commit.testCases)}</div>
          <div className="pg-hint">{`${number.format(commit.testFiles)} test files`}</div>
        </div>
        <div className="pg-card">
          <div className="pg-label">Source lines</div>
          <div className="pg-value">{number.format(commit.sourceLines)}</div>
          <div className="pg-hint">packages/*/src, no tests</div>
        </div>
      </section>

      {adapter && /stub/i.test(adapter) && (
        <p className="pg-notice">
          {`The conformance runner uses the "${adapter}" adapter, so no suite test can pass yet. The line moves when the evaluator (T0008) lands.`}
        </p>
      )}

      <div className="pg-grid">
        <section className="pg-card">
          <div className="pg-card-head">
            <h2>HL7 conformance</h2>
            <fieldset className="pg-seg">
              <legend className="pg-visually-hidden">Test suite</legend>
              {suites.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={name === suite}
                  onClick={() => setSuite(name)}
                >
                  {name.toUpperCase()}
                </button>
              ))}
            </fieldset>
          </div>
          <p className="pg-sub">Phase 1 tests passing (the target of release 0.1.0).</p>
          <LineChart
            label="Phase 1 conformance pass rate per commit"
            commits={commits}
            values={commits.map((item) => passRate(item, suite))}
            yMax={1}
            tick={percent}
            format={percent}
            color="var(--primary)"
            gapUntil={Math.max(firstWithData, 0)}
            gapLabel="runner not added yet"
            active={active}
            onSelect={select}
          />
        </section>
        <section className="pg-card">
          <h2>Roadmap tasks</h2>
          <p className="pg-sub">
            {`Tasks merged, of ${plan.length}. A task counts from the first commit with its Task: line.`}
          </p>
          <LineChart
            label="Roadmap tasks merged per commit"
            commits={commits}
            values={commits.map((_, index) => tasksDoneAt(plan, index))}
            yMax={Math.ceil(plan.length / 10) * 10}
            tick={(value) => String(Math.round(value))}
            format={(value) => `${value}/${plan.length}`}
            color="var(--warning-solid)"
            step
            active={active}
            onSelect={select}
          />
        </section>
        <section className="pg-card">
          <h2>Unit tests</h2>
          <p className="pg-sub">
            Calls of <code>it(</code> and <code>test(</code> in test files. <code>it.each</code>{' '}
            counts once, so this is a lower bound.
          </p>
          <LineChart
            label="Unit test cases per commit"
            commits={commits}
            values={commits.map((item) => item.testCases)}
            tick={(value) => number.format(value)}
            format={(value) => number.format(value)}
            color="var(--success-solid)"
            step
            active={active}
            onSelect={select}
          />
        </section>
        <section className="pg-card">
          <h2>Source size</h2>
          <p className="pg-sub">
            Lines in non-test <code>.ts</code> files under <code>packages/*/src</code>.
          </p>
          <LineChart
            label="Source lines per commit"
            commits={commits}
            values={commits.map((item) => item.sourceLines)}
            tick={(value) => number.format(value)}
            format={(value) => number.format(value)}
            color="var(--pg-pink)"
            step
            active={active}
            onSelect={select}
          />
        </section>
      </div>

      <section className="pg-card">
        <div className="pg-card-head">
          <h2>Roadmap</h2>
          <div className="pg-legend">
            <span>[x] merged</span>
            <span>[&gt;] unblocked</span>
            <span>[ ] blocked</span>
          </div>
        </div>
        <p className="pg-sub">
          Columns are the waves of the roadmap. A task is unblocked when all its dependencies are
          merged. Hover over or focus a task to highlight it, the tasks it depends on{' '}
          <span className="pg-swatch dep" aria-hidden="true" /> and the tasks that depend on it{' '}
          <span className="pg-swatch dependent" aria-hidden="true" />. Click it, or press Enter, for
          its details.
        </p>
        <Board plan={plan} commits={commits} active={active} taskPages={data.taskPages} />
      </section>

      <section className="pg-card">
        <h2>Functions and operators</h2>
        <p className="pg-sub">
          {`${items} of ${functionsTotal} belong to a merged task. A chip lights up when the task that adds it is merged; that says the task landed, not that the function passes the conformance tests.`}
        </p>
        <Functions plan={plan} active={active} />
      </section>

      <section className="pg-card">
        <h2>Commits</h2>
        <CommitLog commits={commits} suite={suite} active={active} onSelect={select} />
      </section>
    </main>
  );
}
