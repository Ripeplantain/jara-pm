"use client";

import { useState } from "react";
import { Modal } from "@/components/board/modal";
import { api, RequestError } from "@/lib/api/browser";
import { shortDate } from "@/lib/dates";
import type { Board } from "@/lib/types/board";
import type { Sprint } from "@/lib/types/sprint";

const message = (err: unknown) =>
  err instanceof RequestError ? err.message : "Something went wrong. Please try again.";

/** The sprint strip above the columns: what is running, how far along, and what to do next. */
export function SprintBar({
  board,
  sprints,
  canWrite,
  onSprintsChanged,
}: {
  board: Board;
  sprints: Sprint[];
  canWrite: boolean;
  onSprintsChanged: (sprints: Sprint[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [completing, setCompleting] = useState<Sprint | null>(null);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [rollTo, setRollTo] = useState<string>("");

  const active = sprints.find((s) => s.state === "active");
  const planned = sprints.filter((s) => s.state === "planned");
  const cards = board.columns.flatMap((c) => c.cards);
  const inSprint = active ? cards.filter((c) => c.sprint_id === active.id) : [];
  const doneIds = new Set(board.columns.filter((c) => c.is_done).map((c) => c.id));
  const done = inSprint.filter((c) => doneIds.has(c.column_id)).length;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const reload = async () => onSprintsChanged(await api.listSprints(board.id));

  if (sprints.length === 0 && !canWrite) return null;

  return (
    <div className="sprint-bar">
      {active ? (
        <>
          <div className="sprint-headline">
            <span className="pill pill-active">Sprint</span>
            <strong>{active.name}</strong>
            {active.goal && <span className="muted">{active.goal}</span>}
            {active.ends_on && <span className="muted">ends {shortDate(active.ends_on)}</span>}
          </div>
          <div className="sprint-progress">
            <div
              className="progress"
              role="progressbar"
              aria-valuenow={done}
              aria-valuemin={0}
              aria-valuemax={Math.max(inSprint.length, 1)}
              aria-label={`Sprint progress: ${done} of ${inSprint.length} cards done`}
            >
              <span
                style={{ width: `${inSprint.length ? (done / inSprint.length) * 100 : 0}%` }}
              />
            </div>
            <span className="muted">
              {done}/{inSprint.length} done
            </span>
          </div>
          {canWrite && (
            <button type="button" disabled={busy} onClick={() => setCompleting(active)}>
              Complete sprint
            </button>
          )}
        </>
      ) : (
        <>
          <div className="sprint-headline">
            <span className="muted">No sprint running.</span>
            {planned.length > 0 && <span className="muted">{planned.length} planned</span>}
          </div>
          {canWrite && planned.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.startSprint(planned[0].id);
                  await reload();
                })
              }
            >
              Start “{planned[0].name}”
            </button>
          )}
          {canWrite && (
            <button type="button" disabled={busy} onClick={() => setCreating(true)}>
              Plan a sprint
            </button>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}

      {creating && (
        <Modal label="Plan a sprint" onClose={() => setCreating(false)}>
          <h2>Plan a sprint</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = name.trim();
              if (!trimmed) return;
              setCreating(false);
              run(async () => {
                await api.createSprint(board.id, { name: trimmed, goal: goal.trim() });
                setName("");
                setGoal("");
                await reload();
              });
            }}
          >
            <div className="field">
              <label htmlFor="sprint-name">Name</label>
              <input
                id="sprint-name"
                value={name}
                maxLength={120}
                required
                autoFocus
                placeholder="e.g. Sprint 12"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="sprint-goal">Goal (optional)</label>
              <textarea
                id="sprint-goal"
                rows={2}
                value={goal}
                maxLength={2000}
                placeholder="What this sprint is for."
                onChange={(e) => setGoal(e.target.value)}
              />
            </div>
            <div className="row-actions">
              <button type="submit" disabled={!name.trim()}>
                Create
              </button>
              <button type="button" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {completing && (
        <Modal label="Complete sprint" onClose={() => setCompleting(null)}>
          <h2>Complete “{completing.name}”?</h2>
          <p>
            {inSprint.length - done} of {inSprint.length} cards are not in a done column. Decide
            where they go; the cards themselves stay where they are on the board.
          </p>
          <div className="field">
            <label htmlFor="roll-to">Unfinished cards</label>
            <select id="roll-to" value={rollTo} onChange={(e) => setRollTo(e.target.value)}>
              <option value="">Back to the backlog</option>
              {planned.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  Move to “{sprint.name}”
                </option>
              ))}
            </select>
          </div>
          <div className="row-actions">
            <button
              type="button"
              onClick={() => {
                const sprint = completing;
                const target = rollTo ? Number(rollTo) : undefined;
                setCompleting(null);
                setRollTo("");
                run(async () => {
                  await api.completeSprint(sprint.id, target);
                  await reload();
                });
              }}
            >
              Complete sprint
            </button>
            <button type="button" onClick={() => setCompleting(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
