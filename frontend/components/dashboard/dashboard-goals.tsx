import Link from "next/link";
import { shortDate } from "@/lib/dates";
import type { Goal } from "@/lib/types/goal";

/**
 * Goal progress on the dashboard. A server component: nothing here is interactive, and the
 * numbers come from the overview the page already fetched.
 *
 * A goal with nothing linked shows a dash rather than 0%, because the two mean different
 * things and a bar at zero would read as "no progress" when it means "not measured".
 */
export function DashboardGoals({ goals }: { goals: Goal[] }) {
  if (goals.length === 0) return null;
  return (
    <section className="dashboard-goals" aria-labelledby="goals-heading">
      <div className="section-heading">
        <h2 id="goals-heading">Goals</h2>
        <Link href="/goals">See all</Link>
      </div>
      <ul className="dashboard-goal-list">
        {goals.map((goal) => (
          <li key={goal.id}>
            <Link href="/goals" className="dashboard-goal">
              <span className="dashboard-goal-title">
                {goal.title}
                {goal.state === "achieved" && <span className="goal-state state-achieved">Achieved</span>}
              </span>
              <span className="dashboard-goal-bar">
                <span
                  className="progress"
                  role="img"
                  aria-label={
                    goal.has_evidence
                      ? `${goal.percent}% complete: ${goal.cards_done} of ${goal.cards_total} linked cards done`
                      : "No linked work yet"
                  }
                >
                  <span style={{ width: `${goal.has_evidence ? goal.percent : 0}%` }} />
                </span>
                <em>{goal.has_evidence ? `${goal.percent}%` : "—"}</em>
              </span>
              <span className="dashboard-goal-meta">
                {goal.has_evidence
                  ? `${goal.cards_done} of ${goal.cards_total} cards`
                  : "Nothing linked yet"}
                {goal.target_date ? ` · by ${shortDate(goal.target_date)}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
