import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart, DataTable } from "@/components/insights/bar-chart";
import { ThroughputChart } from "@/components/insights/throughput-chart";
import { AppShell } from "@/components/shell/app-shell";
import { ApiError, backendFetch } from "@/lib/api/client";
import { getBoard } from "@/lib/api/server";
import { loadShell } from "@/lib/page-data";
import type { BoardAnalytics } from "@/lib/types/analytics";

export const metadata: Metadata = { title: "Insights · Kobi" };
export const dynamic = "force-dynamic";

/** Whole hours below a day, then days: "6h", "3.2 days". */
function cycleTime(hours: number | null): string {
  if (hours === null) return "—";
  return hours < 48 ? `${Math.round(hours)}h` : `${(hours / 24).toFixed(1)} days`;
}

export default async function InsightsPage({ params }: PageProps<"/boards/[id]/insights">) {
  const { id } = await params;
  const boardId = Number(id);
  if (!Number.isInteger(boardId) || boardId < 1) notFound();

  const shell = await loadShell();
  let board;
  let stats: BoardAnalytics;
  try {
    [board, stats] = await Promise.all([
      getBoard(shell.token, boardId),
      backendFetch<BoardAnalytics>(`/api/boards/${boardId}/analytics`, { token: shell.token }),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const columns = stats.columns.map((column) => ({
    label: column.title,
    value: column.count,
    note: column.wip_limit ? `of ${column.wip_limit}` : undefined,
    alarming: column.over_wip_limit,
  }));
  const workload = stats.workload
    .filter((person) => person.open_cards > 0 || person.user_id !== null)
    .map((person) => ({
      label: person.name,
      value: person.open_cards,
      note: person.estimate > 0 ? `· ${person.estimate} pt` : undefined,
    }));

  return (
    <AppShell {...shell} context={board.title}>
      <main id="main-content" className="page insights-page">
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              <Link href={`/boards/${board.id}`}>{board.title}</Link>
            </div>
            <h1>Insights</h1>
          </div>
        </div>

        {/* Headline numbers are figures, not charts: one value each. */}
        <ul className="stat-row">
          <li className="stat-tile">
            <span>Open cards</span>
            <strong>{stats.open_cards}</strong>
          </li>
          <li className="stat-tile">
            <span>Completed</span>
            <strong>{stats.completed_cards}</strong>
          </li>
          <li className={`stat-tile${stats.overdue > 0 ? " alarming" : ""}`}>
            <span>Overdue</span>
            <strong>{stats.overdue}</strong>
          </li>
          <li className="stat-tile">
            <span>Due this week</span>
            <strong>{stats.due_soon}</strong>
          </li>
          <li className="stat-tile">
            <span>Median cycle time</span>
            <strong>{cycleTime(stats.cycle_time_hours)}</strong>
            <small>
              {stats.cycle_time_sample === 0
                ? "nothing completed yet"
                : `from ${stats.cycle_time_sample} completed ${
                    stats.cycle_time_sample === 1 ? "card" : "cards"
                  }`}
            </small>
          </li>
        </ul>

        <section className="insight-card" aria-labelledby="distribution-heading">
          <h2 id="distribution-heading">Where the work sits</h2>
          <p className="muted">
            Cards per column. A column over its work-in-progress limit is marked.
          </p>
          <BarChart data={columns} caption="Cards per column" empty="This board has no columns." />
          <DataTable data={columns} caption="Cards per column" labelHeading="Column" valueHeading="Cards" />
        </section>

        <section className="insight-card" aria-labelledby="throughput-heading">
          <h2 id="throughput-heading">Throughput</h2>
          <p className="muted">
            Cards that reached a done column each week. Mark a column as “done” in its settings
            for this to count anything.
          </p>
          <ThroughputChart weeks={stats.throughput} />
          <DataTable
            data={stats.throughput.map((week) => ({
              label: week.week_starting,
              value: week.completed,
            }))}
            caption="Cards completed per week"
            labelHeading="Week starting"
            valueHeading="Completed"
          />
        </section>

        <section className="insight-card" aria-labelledby="workload-heading">
          <h2 id="workload-heading">Workload</h2>
          <p className="muted">
            Open cards per person, with estimated points where they are set.
            {stats.unestimated > 0 && ` ${stats.unestimated} open cards have no estimate.`}
          </p>
          <BarChart data={workload} caption="Open cards per person" empty="Nothing is assigned." />
          <DataTable
            data={workload}
            caption="Open cards per person"
            labelHeading="Person"
            valueHeading="Open cards"
          />
        </section>
      </main>
    </AppShell>
  );
}
