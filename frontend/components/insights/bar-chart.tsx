/**
 * One-series horizontal bar chart, drawn as inline SVG.
 *
 * Single series, so there is no legend and no categorical palette: every bar wears the same
 * chart hue (`--chart-series`), and only bars the caller flags as a problem wear the status hue.
 * A bar's length is the whole encoding - colouring bars by their own value would spend the one
 * free channel restating the length.
 *
 * Every chart on this page ships with the same table underneath it, so nothing is gated behind
 * being able to see the picture.
 */
export interface BarDatum {
  label: string;
  value: number;
  /** Shown after the value, e.g. "of 5" for a WIP limit. */
  note?: string;
  /** Paints this bar with the status hue: over a limit, overdue, at risk. */
  alarming?: boolean;
}

const BAR = 20; // <= 24px: the band keeps its air
const GAP = 12;
const LABEL_WIDTH = 132;
const VALUE_WIDTH = 56;
const RIGHT_PAD = 8;

export function BarChart({
  data,
  caption,
  width = 520,
  empty = "Nothing to show yet.",
}: {
  data: BarDatum[];
  caption: string;
  width?: number;
  empty?: string;
}) {
  if (data.length === 0) return <p className="empty-state">{empty}</p>;

  const max = Math.max(...data.map((d) => d.value), 1);
  const plot = Math.max(80, width - LABEL_WIDTH - VALUE_WIDTH - RIGHT_PAD);
  const height = data.length * (BAR + GAP);

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={caption}
        className="chart-svg"
        preserveAspectRatio="xMinYMin meet"
      >
        {data.map((datum, i) => {
          const y = i * (BAR + GAP);
          const length = Math.max((datum.value / max) * plot, datum.value > 0 ? 3 : 0);
          return (
            <g key={datum.label}>
              <text x={0} y={y + BAR * 0.72} className="chart-label">
                {datum.label.length > 18 ? `${datum.label.slice(0, 17)}…` : datum.label}
              </text>
              {/* Track: the full width the bar could reach, so short bars still read as small. */}
              <rect x={LABEL_WIDTH} y={y} width={plot} height={BAR} rx={4} className="chart-track" />
              {length > 0 && (
                <rect
                  x={LABEL_WIDTH}
                  y={y}
                  width={length}
                  height={BAR}
                  rx={4}
                  className={datum.alarming ? "chart-bar alarming" : "chart-bar"}
                />
              )}
              <text x={LABEL_WIDTH + plot + RIGHT_PAD} y={y + BAR * 0.72} className="chart-value">
                {datum.value}
                {datum.note ? ` ${datum.note}` : ""}
              </text>
              <title>
                {datum.label}: {datum.value}
                {datum.note ? ` ${datum.note}` : ""}
              </title>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}

/** The same numbers as a table. Always rendered, never hidden behind a toggle. */
export function DataTable({
  data,
  caption,
  valueHeading,
  labelHeading = "Name",
}: {
  data: BarDatum[];
  caption: string;
  valueHeading: string;
  labelHeading?: string;
}) {
  if (data.length === 0) return null;
  return (
    <table className="chart-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{labelHeading}</th>
          <th scope="col">{valueHeading}</th>
        </tr>
      </thead>
      <tbody>
        {data.map((datum) => (
          <tr key={datum.label}>
            <th scope="row">{datum.label}</th>
            <td>
              {datum.value}
              {datum.note ? ` ${datum.note}` : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
