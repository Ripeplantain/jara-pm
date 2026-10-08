import { shortDate } from "@/lib/dates";
import type { WeekStat } from "@/lib/types/analytics";

const COL = 26; // <= 24px of bar plus the 2px surface gap between neighbours
const BAR = 24;
const HEIGHT = 120;
const AXIS = 18;

/**
 * Cards completed per week, as columns. One series over time, so one hue and no legend; only
 * the best week is labelled directly - a number on every column reads as noise.
 */
export function ThroughputChart({ weeks }: { weeks: WeekStat[] }) {
  const max = Math.max(...weeks.map((w) => w.completed), 1);
  const best = weeks.reduce((a, b) => (b.completed > a.completed ? b : a), weeks[0]);
  const width = weeks.length * COL;
  const caption = `Cards completed per week over the last ${weeks.length} weeks`;

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${width} ${HEIGHT + AXIS}`}
        role="img"
        aria-label={caption}
        className="chart-svg throughput"
        preserveAspectRatio="xMinYMax meet"
      >
        <line x1={0} y1={HEIGHT} x2={width} y2={HEIGHT} className="chart-axis" />
        {weeks.map((week, i) => {
          const barHeight = week.completed === 0 ? 0 : Math.max((week.completed / max) * (HEIGHT - 20), 3);
          const x = i * COL;
          const labelled = week.completed > 0 && week.week_starting === best.week_starting;
          return (
            <g key={week.week_starting}>
              {barHeight > 0 && (
                <rect
                  x={x}
                  y={HEIGHT - barHeight}
                  width={BAR}
                  height={barHeight}
                  rx={4}
                  className="chart-bar"
                />
              )}
              {labelled && (
                <text x={x + BAR / 2} y={HEIGHT - barHeight - 5} className="chart-value mid">
                  {week.completed}
                </text>
              )}
              {i % 2 === 0 && (
                <text x={x + BAR / 2} y={HEIGHT + 13} className="chart-label mid">
                  {shortDate(week.week_starting)}
                </text>
              )}
              <title>
                Week of {shortDate(week.week_starting)}: {week.completed} completed
              </title>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}
