"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { api, RequestError } from "@/lib/api/browser";
import { HABIT_COLORS, MAX_TARGET_PER_WEEK, SCHEDULES, scheduleLabel, streakLabel } from "@/lib/types/habit";
import type { Habit, HabitColor, HabitSchedule } from "@/lib/types/habit";

const GRID_WEEKS = 5;
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * The habit list and its check-in grid.
 *
 * There is no role gating anywhere in here, unlike every other surface in Kobi: a habit is the
 * caller's own and affects nobody else, so a viewer keeps theirs in a workspace they can only
 * read. The backend decides that; this component simply has no role to hide behind.
 *
 * Every cell in the grid is a real button with its own accessible name, rather than a div with
 * a click handler, because backfilling yesterday is the second thing anyone wants to do here
 * and it has to work from the keyboard.
 */
export function HabitsView({ workspaceId, initial }: { workspaceId: number; initial: Habit[] }) {
  const [habits, setHabits] = useState(initial);
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Something went wrong. Try again.");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  /** One habit came back changed: swap it in rather than refetching the list. */
  function replace(habit: Habit) {
    setHabits((current) => current.map((row) => (row.id === habit.id ? habit : row)));
  }

  async function reload(archived = showArchived) {
    const fresh = await run(() => api.listHabits(workspaceId, archived));
    if (fresh) setHabits(fresh);
  }

  async function toggle(habit: Habit, day: string, done: boolean) {
    const updated = await run(() => api.setCheckin(habit.id, { on_date: day, done }));
    if (updated) replace(updated);
  }

  const visible = habits.filter((habit) => showArchived || !habit.archived_at);
  const due = visible.filter((habit) => habit.due_today).length;

  return (
    <section className="habits">
      <div className="notes-index-bar">
        <div className="habits-bar-actions">
          <button type="button" className="primary" onClick={() => setAdding(true)} disabled={busy}>
            <Icon name="plus" size="sm" /> New habit
          </button>
          {visible.length > 0 && (
            <p className="muted" aria-live="polite">
              {due === 0 ? "Everything is done for today." : `${due} still due today.`}
            </p>
          )}
        </div>
        <label className="notes-archived-toggle">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => {
              setShowArchived(event.target.checked);
              void reload(event.target.checked);
            }}
          />
          Show archived
        </label>
      </div>

      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}

      {adding && (
        <HabitForm
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={async (body) => {
            const created = await run(() => api.createHabit(workspaceId, body));
            if (created) {
              setHabits((current) => [...current, created]);
              setAdding(false);
            }
          }}
        />
      )}

      {visible.length === 0 ? (
        <div className="empty-state">
          <strong>No habits yet</strong>
          <span>
            Track the repeating things a card cannot hold: writing every day, a weekly review,
            three runs a week. Habits are private to you - nobody else in the workspace can see
            them.
          </span>
        </div>
      ) : (
        <ul className="habit-list">
          {visible.map((habit) => (
            <li key={habit.id} className={`habit-card tint-${habit.color}`}>
              <div className="habit-head">
                <div className="habit-identity">
                  <h2>{habit.name}</h2>
                  <p className="habit-meta">
                    <span>{scheduleLabel(habit)}</span>
                    {habit.schedule !== "daily" && (
                      <span>
                        {habit.week_done}/{habit.week_target} this week
                      </span>
                    )}
                    <span className="habit-streak">
                      <Icon name="flame" size="sm" /> {streakLabel(habit)}
                    </span>
                    {habit.longest_streak > habit.current_streak && (
                      <span>best {habit.longest_streak}</span>
                    )}
                    {habit.archived_at && <span className="note-badge">Archived</span>}
                  </p>
                  {habit.detail && <p className="habit-detail">{habit.detail}</p>}
                </div>

                <div className="habit-actions">
                  {!habit.archived_at && (
                    <button
                      type="button"
                      className={`habit-today${habit.done_today ? " done" : ""}`}
                      aria-pressed={habit.done_today}
                      disabled={busy}
                      onClick={() => toggle(habit, today(), !habit.done_today)}
                    >
                      <Icon name={habit.done_today ? "circle-check" : "plus"} size="sm" />
                      {habit.done_today ? "Done today" : "Mark today"}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Edit ${habit.name}`}
                    aria-expanded={editing === habit.id}
                    disabled={busy}
                    onClick={() => setEditing(editing === habit.id ? null : habit.id)}
                  >
                    <Icon name="type" size="sm" />
                  </button>
                  {habit.archived_at ? (
                    <>
                      <button
                        type="button"
                        aria-label={`Restore ${habit.name}`}
                        disabled={busy}
                        onClick={async () => {
                          const restored = await run(() => api.unarchiveHabit(habit.id));
                          if (restored) replace(restored);
                        }}
                      >
                        <Icon name="arrow-up" size="sm" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${habit.name} and its check-ins`}
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm(`Delete “${habit.name}” and every check-in on it?`)) return;
                          const gone = await run(() => api.deleteHabit(habit.id));
                          if (gone !== undefined) {
                            setHabits((current) => current.filter((row) => row.id !== habit.id));
                          }
                        }}
                      >
                        <Icon name="trash-2" size="sm" />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Archive ${habit.name}`}
                      disabled={busy}
                      onClick={async () => {
                        const archived = await run(() => api.archiveHabit(habit.id));
                        if (archived) {
                          if (showArchived) replace(archived);
                          else setHabits((current) => current.filter((row) => row.id !== habit.id));
                        }
                      }}
                    >
                      <Icon name="archive" size="sm" />
                    </button>
                  )}
                </div>
              </div>

              {editing === habit.id && (
                <HabitForm
                  habit={habit}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (body) => {
                    const saved = await run(() => api.updateHabit(habit.id, body));
                    if (saved) {
                      replace(saved);
                      setEditing(null);
                    }
                  }}
                />
              )}

              <CheckinGrid habit={habit} busy={busy} onToggle={toggle} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The grid of recent days. Weeks run down the columns, weekdays across the rows. */
function CheckinGrid({
  habit,
  busy,
  onToggle,
}: {
  habit: Habit;
  busy: boolean;
  onToggle: (habit: Habit, day: string, done: boolean) => void;
}) {
  const done = new Set(habit.history);
  const weeks = recentWeeks();
  return (
    <div className="habit-grid" role="group" aria-label={`Recent check-ins for ${habit.name}`}>
      <div className="habit-grid-days" aria-hidden="true">
        {WEEKDAYS.map((letter, index) => (
          <span key={index}>{letter}</span>
        ))}
      </div>
      {weeks.map((week, index) => (
        <div className="habit-grid-week" key={index}>
          {week.map((day) => {
            const future = day > today();
            const ticked = done.has(day);
            return (
              <button
                key={day}
                type="button"
                className={`habit-cell${ticked ? " ticked" : ""}`}
                aria-pressed={ticked}
                aria-label={`${ticked ? "Clear" : "Mark"} ${habit.name} on ${readable(day)}`}
                disabled={busy || future || Boolean(habit.archived_at)}
                onClick={() => onToggle(habit, day, !ticked)}
              >
                <span aria-hidden="true">{ticked ? "●" : future ? "" : "·"}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Create and edit share one form: the fields are the same, and so are the rules. */
function HabitForm({
  habit,
  busy,
  onCancel,
  onSubmit,
}: {
  habit?: Habit;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: {
    name: string;
    detail: string;
    schedule: HabitSchedule;
    target_per_week: number;
    color: HabitColor;
  }) => void;
}) {
  const [name, setName] = useState(habit?.name ?? "");
  const [detail, setDetail] = useState(habit?.detail ?? "");
  const [schedule, setSchedule] = useState<HabitSchedule>(habit?.schedule ?? "daily");
  const [target, setTarget] = useState(habit?.target_per_week ?? 3);
  const [color, setColor] = useState<HabitColor>((habit?.color as HabitColor) ?? "indigo");
  const id = habit ? `habit-${habit.id}` : "habit-new";

  return (
    <form
      className="habit-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        onSubmit({ name: name.trim(), detail: detail.trim(), schedule, target_per_week: target, color });
      }}
    >
      <div className="habit-form-row">
        <label htmlFor={`${id}-name`}>
          Habit
          <input
            id={`${id}-name`}
            value={name}
            required
            maxLength={120}
            placeholder="Write every day"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label htmlFor={`${id}-schedule`}>
          How often
          <select
            id={`${id}-schedule`}
            value={schedule}
            onChange={(event) => setSchedule(event.target.value as HabitSchedule)}
          >
            {SCHEDULES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {schedule === "times_per_week" && (
          <label htmlFor={`${id}-target`}>
            Times a week
            <input
              id={`${id}-target`}
              type="number"
              min={1}
              max={MAX_TARGET_PER_WEEK}
              value={target}
              onChange={(event) => setTarget(Number(event.target.value))}
            />
          </label>
        )}
        <label htmlFor={`${id}-color`}>
          Colour
          <select
            id={`${id}-color`}
            value={color}
            onChange={(event) => setColor(event.target.value as HabitColor)}
          >
            {HABIT_COLORS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label htmlFor={`${id}-detail`}>
        Why it matters <span className="muted">(optional)</span>
        <input
          id={`${id}-detail`}
          value={detail}
          maxLength={500}
          onChange={(event) => setDetail(event.target.value)}
        />
      </label>
      <div className="habit-form-actions">
        <button type="submit" className="primary" disabled={busy || !name.trim()}>
          {habit ? "Save habit" : "Add habit"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Today as the backend sees it: a plain YYYY-MM-DD day. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The last `GRID_WEEKS` weeks of days, Monday first, oldest week first. */
function recentWeeks(): string[][] {
  const now = new Date();
  const monday = new Date(now);
  // getDay() is 0 for Sunday, so shift it to a Monday-first week.
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) - (GRID_WEEKS - 1) * 7);
  return Array.from({ length: GRID_WEEKS }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + week * 7 + day);
      return date.toISOString().slice(0, 10);
    }),
  );
}

function readable(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
