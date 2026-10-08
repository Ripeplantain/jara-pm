import Link from "next/link";
import type { WorkspaceOverview } from "@/lib/types/analytics";

export function DashboardBriefing({ overview }: { overview: WorkspaceOverview }) {
  const overdue = overview.boards.reduce((total, board) => total + board.overdue, 0);
  const favorites = overview.boards.filter((board) => board.is_favorite);
  const message = overdue
    ? `Start with the ${overdue} overdue ${overdue === 1 ? "card" : "cards"} before planning new work.`
    : overview.my_open_cards
      ? "Your next move is visible: keep the assigned work moving before adding more scope."
      : "Your workspace is clear. Capture the next product bet and give it a home on a board.";

  return (
    <section className="dashboard-grid" aria-label="Workspace briefing">
      <article className="briefing-card">
        <div className="briefing-kicker"><span aria-hidden="true">✦</span> Kobi briefing</div>
        <h2>{message}</h2>
        <p>Based on assigned work, due dates and your workspace activity.</p>
        <Link href={overview.my_open_cards ? "/my-work" : "/members"} className="inline-action">
          {overview.my_open_cards ? "Open my work" : "Invite a teammate"} <span aria-hidden="true">↗</span>
        </Link>
      </article>
      <div className="briefing-side">
        <div className="briefing-stat"><strong>{overview.boards.length}</strong><span>boards</span></div>
        <div className="briefing-stat"><strong>{favorites.length}</strong><span>favorites</span></div>
        <div className={`briefing-stat${overdue ? " alarm" : ""}`}><strong>{overdue}</strong><span>at risk</span></div>
      </div>
      {overview.signals.length > 0 && (
        <div className="briefing-signals" aria-label="Kobi signals">
          <div className="briefing-signals-head">
            <strong>Worth a look</strong>
            <span>Deterministic workspace signals</span>
          </div>
          <ul>
            {overview.signals.slice(0, 4).map((signal) => (
              <li key={`${signal.kind}-${signal.board_id}-${signal.card_id ?? "all"}`}>
                <span className={`signal-dot ${signal.severity}`} aria-hidden="true" />
                <div>
                  <Link href={`/boards/${signal.board_id}${signal.card_id ? `?card=${signal.card_id}` : ""}`}>
                    {signal.title}
                  </Link>
                  <p>{signal.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {overview.active_sprints.length > 0 && (
        <div className="briefing-sprints" aria-label="Current sprint health">
          <div className="briefing-signals-head">
            <strong>Current sprint health</strong>
            <span>{overview.active_sprints.length} active sprint{overview.active_sprints.length === 1 ? "" : "s"}</span>
          </div>
          {overview.active_sprints.map((sprint) => {
            const percent = sprint.total ? Math.round((sprint.done / sprint.total) * 100) : 0;
            return (
              <Link key={sprint.sprint_id} href={`/boards/${sprint.board_id}`} className="sprint-health-row">
                <span><strong>{sprint.name}</strong><small>{sprint.board_title}</small></span>
                <span className="sprint-health-progress"><span style={{ width: `${percent}%` }} /><em>{sprint.done}/{sprint.total}</em></span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
