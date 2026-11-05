import type { CommitPoint } from '../../../progress/types.ts';

const WIDTH = 520;
const PAD_LEFT = 40;
const PAD_RIGHT = 58;
const PAD_TOP = 12;
const PAD_BOTTOM = 4;

/** A round upper bound for an axis that has to hold `value`. */
function niceMax(value: number): number {
  if (value <= 0) {
    return 1;
  }
  const power = 10 ** Math.floor(Math.log10(value));
  for (const multiple of [1, 2, 2.5, 5, 10]) {
    if (multiple * power >= value) {
      return multiple * power;
    }
  }
  return 10 * power;
}

export interface LineChartProps {
  /** Accessible name of the chart. */
  label: string;
  commits: readonly CommitPoint[];
  /** One value per commit; null where there is no data. */
  values: readonly (number | null)[];
  /** The top of the axis; defaults to a round number above the largest value. */
  yMax?: number;
  tick: (value: number) => string;
  format: (value: number) => string;
  /** A CSS colour. */
  color: string;
  /** Draw steps instead of slopes, for counts that change only at a commit. */
  step?: boolean;
  /** Commits before this index have no data; they are shaded and named `gapLabel`. */
  gapUntil?: number;
  gapLabel?: string;
  /** The selected commit. */
  active: number;
  onSelect: (index: number) => void;
}

/** A chart with one point per commit, from the first commit to the last. */
export function LineChart({
  label,
  commits,
  values,
  yMax: fixedMax,
  tick,
  format,
  color,
  step = false,
  gapUntil = 0,
  gapLabel = '',
  active,
  onSelect,
}: LineChartProps) {
  const height = 130;
  const count = commits.length;
  const spacing = count <= 1 ? 40 : (WIDTH - PAD_LEFT - PAD_RIGHT) / (count - 1);
  const xAt = (index: number) => PAD_LEFT + index * spacing;
  const largest = Math.max(0, ...values.filter((value): value is number => value !== null));
  const yMax = fixedMax ?? niceMax(largest * 1.05);
  const yAt = (value: number) => PAD_TOP + (height - PAD_TOP - PAD_BOTTOM) * (1 - value / yMax);
  const labelEvery = spacing < 24 ? Math.ceil(24 / spacing) : 1;

  let path = '';
  values.forEach((value, index) => {
    if (value === null) {
      return;
    }
    const connected = index > 0 && values[index - 1] !== null;
    if (step && connected) {
      path += `H${xAt(index)}V${yAt(value)}`;
    } else {
      path += `${connected ? 'L' : 'M'}${xAt(index)} ${yAt(value)}`;
    }
  });
  const first = values.findIndex((value) => value !== null);
  const last = values.findLastIndex((value) => value !== null);
  const lastValue = values[last] ?? null;

  const gapLeft = PAD_LEFT - 6;
  const gapRight = xAt(gapUntil) - spacing / 2;

  return (
    <svg
      className="pg-chart"
      viewBox={`0 0 ${WIDTH} ${height + 20}`}
      role="img"
      aria-label={label}
      style={{ ['--pg-color' as string]: color }}
    >
      {[0, 1, 2, 3, 4].map((line) => {
        const value = (yMax * line) / 4;
        return (
          <g key={line}>
            <line
              className={line === 0 ? 'pg-axis' : 'pg-grid'}
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={yAt(value)}
              y2={yAt(value)}
            />
            <text x={PAD_LEFT - 6} y={yAt(value) + 3.5} textAnchor="end">
              {tick(value)}
            </text>
          </g>
        );
      })}

      {gapUntil > 0 && (
        <g>
          <rect
            className="pg-gap"
            x={gapLeft}
            y={PAD_TOP}
            width={gapRight - gapLeft}
            height={height - PAD_TOP - PAD_BOTTOM}
          />
          <text
            x={(gapLeft + gapRight) / 2}
            y={PAD_TOP + (height - PAD_TOP - PAD_BOTTOM) / 2}
            textAnchor="middle"
          >
            {gapLabel}
          </text>
        </g>
      )}

      {first >= 0 && last > first && (
        <path className="pg-area" d={`${path}V${yAt(0)}H${xAt(first)}Z`} />
      )}
      <path className="pg-line" d={path} />

      {commits.map((commit, index) =>
        index % labelEvery === 0 ? (
          <text key={commit.sha} x={xAt(index)} y={height + 13} textAnchor="middle">
            {commit.pr ? `#${commit.pr}` : 'init'}
          </text>
        ) : null,
      )}

      {values.map((value, index) =>
        value === null ? null : (
          <circle
            key={commits[index]?.sha ?? index}
            className="pg-dot"
            cx={xAt(index)}
            cy={yAt(value)}
            r={index === active ? 5.5 : 3}
          />
        ),
      )}

      {lastValue !== null && last >= 0 && (
        <text
          className="pg-end-label"
          x={xAt(last) + 9}
          y={yAt(lastValue) + (lastValue === 0 ? -6 : 4)}
        >
          {format(lastValue)}
        </text>
      )}

      <line
        className="pg-guide"
        x1={xAt(active)}
        x2={xAt(active)}
        y1={PAD_TOP}
        y2={height - PAD_BOTTOM}
      />

      {commits.map((commit, index) => (
        // Keyboard users step through the commits with the arrow keys and the
        // scrubber, so these hit areas are a pointer shortcut and not a control.
        // biome-ignore lint/a11y/noStaticElementInteractions: pointer shortcut, see above
        <rect
          key={commit.sha}
          className="pg-hit"
          x={xAt(index) - spacing / 2}
          y={0}
          width={spacing}
          height={height + 20}
          onClick={() => onSelect(index)}
        >
          <title>{`${commit.pr ? `#${commit.pr} ` : ''}${commit.subject}`}</title>
        </rect>
      ))}
    </svg>
  );
}
