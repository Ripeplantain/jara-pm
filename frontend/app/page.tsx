import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { BoardList } from "@/components/board/board-list";
import { DashboardBriefing } from "@/components/dashboard/dashboard-briefing";
import { ApiError } from "@/lib/api/client";
import { getOverview, listTemplates } from "@/lib/api/server";
import { getOnboardingStatus } from "@/lib/api/server";
import { loadShell } from "@/lib/page-data";
import { redirect } from "next/navigation";
import { shortAgo } from "@/lib/dates";

export const metadata: Metadata = { title: "Boards · Kobi" };
export const dynamic = "force-dynamic";

export default async function Home() {
  const shell = await loadShell();
  if (!shell.active) {
    // Every account gets a personal workspace at registration, so this only happens if the last
    // one was deleted out from under them in another tab.
    return (
      <AppShell {...shell} active={null}>
        <main id="main-content" className="dashboard-page">
          <h1>No workspace</h1>
          <p>You are not a member of any workspace yet. Ask a colleague to invite you.</p>
        </main>
      </AppShell>
    );
  }

  const onboarding = await getOnboardingStatus(shell.token);
  if (!onboarding.completed) redirect("/onboarding");

  let overview;
  let templates;
  try {
    [overview, templates] = await Promise.all([
      getOverview(shell.token, shell.active.id),
      listTemplates(shell.token),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw err;
    throw err;
  }

  return (
    <AppShell {...shell}>
      <main id="main-content" className="dashboard-page">
        <section className="dashboard-hero" aria-labelledby="dashboard-title">
          <div>
            <div className="eyebrow">{shell.active.name}</div>
            <h1 id="dashboard-title">Hello, {shell.user.name.split(" ")[0]}</h1>
            <p>
              {overview.my_open_cards === 0
                ? "Nothing is assigned to you right now."
                : `You have ${overview.my_open_cards} open ${
                    overview.my_open_cards === 1 ? "card" : "cards"
                  }${overview.my_overdue > 0 ? `, ${overview.my_overdue} overdue` : ""}.`}
            </p>
          </div>
          <div className="hero-metrics">
            <Link href="/my-work" className="hero-metric">
              <strong>{overview.my_open_cards}</strong>
              <span>assigned to me</span>
            </Link>
            <Link href="/my-work" className="hero-metric">
              <strong>{overview.my_due_soon}</strong>
              <span>due this week</span>
            </Link>
            <Link href="/my-work" className={`hero-metric${overview.my_overdue ? " alarming" : ""}`}>
              <strong>{overview.my_overdue}</strong>
              <span>overdue</span>
            </Link>
          </div>
        </section>

        <DashboardBriefing overview={overview} />

        <BoardList
          boards={overview.boards}
          templates={templates}
          role={shell.active.my_role}
          workspaceId={shell.active.id}
        />

        <section className="recent-activity" aria-labelledby="recent-heading">
          <div className="section-heading">
            <h2 id="recent-heading">Recent activity</h2>
            <Link href="/activity">See all</Link>
          </div>
          {overview.recent_activity.length === 0 ? (
            <p className="empty-state">Nothing has happened here yet.</p>
          ) : (
            <ul className="activity-list">
              {overview.recent_activity.map((entry) => (
                <li key={entry.id}>
                  <span className="activity-actor">{entry.actor?.name ?? "Someone"}</span>{" "}
                  {entry.summary}
                  <span className="activity-time">{shortAgo(entry.created_at)} ago</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </AppShell>
  );
}
