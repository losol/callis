import { phase1Of } from '../../../progress/state.ts';
import type { CommitPoint } from '../../../progress/types.ts';

const number = new Intl.NumberFormat('en');

export interface CommitLogProps {
  commits: readonly CommitPoint[];
  suite: string;
  /** The selected commit. */
  active: number;
  onSelect: (index: number) => void;
}

/** The commits as a table: the same numbers as the charts, in text. */
export function CommitLog({ commits, suite, active, onSelect }: CommitLogProps) {
  return (
    <div className="pg-table-wrap">
      <table className="pg-table">
        <thead>
          <tr>
            <th className="left">PR</th>
            <th className="left">Commit</th>
            <th className="left">Subject</th>
            <th className="left">Task</th>
            <th>Phase 1 pass</th>
            <th>Tests</th>
            <th>Source lines</th>
          </tr>
        </thead>
        <tbody>
          {commits.map((commit, index) => {
            const totals = phase1Of(commit, suite);
            return (
              <tr
                key={commit.sha}
                className={index === active ? 'active' : undefined}
                aria-selected={index === active}
              >
                <td className="left">{commit.pr ? `#${commit.pr}` : '–'}</td>
                <td className="left sha">{commit.sha.slice(0, 7)}</td>
                <td className="left subject">
                  <button type="button" onClick={() => onSelect(index)}>
                    {commit.subject}
                  </button>
                </td>
                <td className="left">{commit.tasks.join(' ') || '–'}</td>
                <td>
                  {totals
                    ? `${number.format(totals.passed)} / ${number.format(totals.total)}`
                    : '–'}
                </td>
                <td>{number.format(commit.testCases)}</td>
                <td>{number.format(commit.sourceLines)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
