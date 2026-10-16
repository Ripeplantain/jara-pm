"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { api, RequestError } from "@/lib/api/browser";
import { scheduleLabel, streakLabel } from "@/lib/types/habit";
import type { Habit } from "@/lib/types/habit";

/**
 * Today's habits on the dashboard: the ones still outstanding first, each tickable in place.
 *
 * The habits come from the overview the page already fetched, so this costs no extra request on
 * load; a tick sends one request and takes the habit the server returns, because the streak it
 * reports is derived there and cannot be guessed here.
 */
export function DashboardHabits({ initial }: { initial: Habit[] }) {
  const [habits, setHabits] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (habits.length === 0) return null;

  async function toggle(habit: Habit) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.setCheckin(habit.id, { done: !habit.done_today });
      setHabits((current) => current.map((row) => (row.id === habit.id ? updated : row)));
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Couldn’t save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Outstanding first, then the ones already done, so the list reads as a to-do.
  const ordered = [...habits].sort(
    (a, b) => Number(a.done_today) - Number(b.done_today) || a.id - b.id,
  );
  const due = habits.filter((habit) => habit.due_today).length;

  return (
    <section className="dashboard-habits" aria-labelledby="habits-heading">
      <div className="section-heading">
        <h2 id="habits-heading">Today&rsquo;s habits</h2>
        <Link href="/habits">See all</Link>
      </div>
      <p className="muted" aria-live="polite">
        {due === 0 ? "All done for today." : `${due} still due today.`}
      </p>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <ul className="dashboard-habit-list">
        {ordered.map((habit) => (
          <li key={habit.id} className={`tint-${habit.color}`}>
            <button
              type="button"
              className={`habit-tick${habit.done_today ? " done" : ""}`}
              aria-pressed={habit.done_today}
              aria-label={`${habit.done_today ? "Clear" : "Mark"} ${habit.name} for today`}
              disabled={busy}
              onClick={() => toggle(habit)}
            >
              <Icon name={habit.done_today ? "circle-check" : "plus"} size="sm" />
            </button>
            <span className="dashboard-habit-name">{habit.name}</span>
            <span className="dashboard-habit-meta">
              {scheduleLabel(habit)}
              {habit.current_streak > 0 ? ` · ${streakLabel(habit)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
