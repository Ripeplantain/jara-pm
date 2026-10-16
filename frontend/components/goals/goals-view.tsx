"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { WorkPicker } from "@/components/work-picker";
import type { WorkChoice } from "@/components/work-picker";
import { api, RequestError } from "@/lib/api/browser";
import { shortDate } from "@/lib/dates";
import { linkHref, linkLabel, STATE_LABELS } from "@/lib/types/goal";
import type { Goal, GoalLink, GoalLinkType, GoalMilestone, GoalState } from "@/lib/types/goal";
import { canWrite } from "@/lib/types/workspace";
import type { Role } from "@/lib/types/workspace";

interface Props {
  workspaceId: number;
  role: Role;
  initial: Goal[];
}

/** What a link is being added to: the goal itself, or one of its milestones. */
interface Linking {
  goalId: number;
  milestoneId: number | null;
  target: GoalLinkType;
}

/**
 * The goals page.
 *
 * Every mutation here returns the whole goal, and the component replaces its copy with what
 * came back rather than adjusting a local percentage. That is deliberate: progress is computed
 * from the board, so the server is the only thing that knows what a change did to it.
 */
export function GoalsView({ workspaceId, role, initial }: Props) {
  const [goals, setGoals] = useState(initial);
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [linking, setLinking] = useState<Linking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mayWrite = canWrite(role);

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

  function replace(goal: Goal) {
    setGoals((current) => current.map((row) => (row.id === goal.id ? goal : row)));
  }

  async function reload(archived = showArchived) {
    const fresh = await run(() => api.listGoals(workspaceId, archived));
    if (fresh) setGoals(fresh);
  }

  /** Any goal mutation: run it, then take the server's version of the goal. */
  async function change(work: () => Promise<Goal>) {
    const updated = await run(work);
    if (!updated) return;
    if (updated.state === "archived" && !showArchived) {
      setGoals((current) => current.filter((row) => row.id !== updated.id));
    } else {
      replace(updated);
    }
  }

  async function addLink(choice: WorkChoice) {
    if (!linking) return;
    const target_id = choice.cardId ?? choice.boardId ?? choice.sprintId;
    if (target_id === undefined) return;
    await change(() =>
      api.addGoalLink(linking.goalId, {
        target_type: linking.target,
        target_id,
        milestone_id: linking.milestoneId,
      }),
    );
    setLinking(null);
  }

  const visible = goals.filter((goal) => showArchived || goal.state !== "archived");

  return (
    <section className="goals">
      <div className="notes-index-bar">
        {mayWrite ? (
          <button type="button" className="primary" onClick={() => setAdding(true)} disabled={busy}>
            <Icon name="plus" size="sm" /> New goal
          </button>
        ) : (
          <p className="muted">Your role is read-only, so you can follow goals but not set them.</p>
        )}
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
        <GoalForm
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={async (body) => {
            const created = await run(() => api.createGoal(workspaceId, body));
            if (created) {
              setGoals((current) => [...current, created]);
              setAdding(false);
            }
          }}
        />
      )}

      {visible.length === 0 ? (
        <div className="empty-state">
          <strong>No goals yet</strong>
          <span>
            A goal says what the boards are for. Give it milestones, point each one at a board,
            a sprint or a few cards, and its progress follows the work instead of being typed in.
          </span>
        </div>
      ) : (
        <ul className="goal-list">
          {visible.map((goal) => (
            <li key={goal.id} className="goal-card">
              <div className="goal-head">
                <div className="goal-identity">
                  <h2>{goal.title}</h2>
                  <p className="goal-meta">
                    <span className={`goal-state state-${goal.state}`}>
                      {STATE_LABELS[goal.state]}
                    </span>
                    {goal.target_date && <span>by {shortDate(goal.target_date)}</span>}
                    {goal.unresolved_links > 0 && (
                      <span className="goal-warning">
                        {goal.unresolved_links} link
                        {goal.unresolved_links === 1 ? "" : "s"} no longer resolve
                      </span>
                    )}
                  </p>
                  {goal.detail && <p className="goal-detail">{goal.detail}</p>}
                </div>
                <Progress goal={goal} />
              </div>

              {mayWrite && (
                <div className="goal-actions">
                  <button
                    type="button"
                    onClick={() => setEditing(editing === goal.id ? null : goal.id)}
                    aria-expanded={editing === goal.id}
                    disabled={busy}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setLinking({ goalId: goal.id, milestoneId: null, target: "card" })
                    }
                    disabled={busy}
                  >
                    Link work
                  </button>
                  <AddMilestone goal={goal} busy={busy} onAdd={change} />
                  <button
                    type="button"
                    onClick={() =>
                      change(() =>
                        api.updateGoal(goal.id, {
                          state: goal.state === "achieved" ? "active" : "achieved",
                        }),
                      )
                    }
                    disabled={busy}
                  >
                    {goal.state === "achieved" ? "Reopen" : "Mark achieved"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      change(() =>
                        api.updateGoal(goal.id, {
                          state: goal.state === "archived" ? "active" : "archived",
                        }),
                      )
                    }
                    disabled={busy}
                  >
                    {goal.state === "archived" ? "Restore" : "Archive"}
                  </button>
                  <button
                    type="button"
                    className="goal-danger"
                    disabled={busy}
                    onClick={async () => {
                      if (!confirm(`Delete “${goal.title}”, its milestones and its links?`)) return;
                      const gone = await run(() => api.deleteGoal(goal.id));
                      if (gone !== undefined) {
                        setGoals((current) => current.filter((row) => row.id !== goal.id));
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}

              {editing === goal.id && (
                <GoalForm
                  goal={goal}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (body) => {
                    await change(() => api.updateGoal(goal.id, body));
                    setEditing(null);
                  }}
                />
              )}

              {goal.milestones.length > 0 && (
                <ol className="milestone-list">
                  {goal.milestones.map((milestone, index) => (
                    <Milestone
                      key={milestone.id}
                      goal={goal}
                      milestone={milestone}
                      index={index}
                      mayWrite={mayWrite}
                      busy={busy}
                      onChange={change}
                      onLink={(target) =>
                        setLinking({ goalId: goal.id, milestoneId: milestone.id, target })
                      }
                    />
                  ))}
                </ol>
              )}

              {goal.links.length > 0 && (
                <div className="goal-direct-links">
                  <p className="menu-label">Linked directly to this goal</p>
                  <ul className="goal-links">
                    {goal.links.map((link) => (
                      <LinkRow
                        key={link.id}
                        link={link}
                        mayWrite={mayWrite}
                        busy={busy}
                        onRemove={() => change(() => api.removeGoalLink(link.id))}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {!goal.has_evidence && (
                <p className="muted goal-no-evidence">
                  Nothing is linked yet, so there is no progress to measure. Link a board, a
                  sprint or a few cards and it will follow them.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {linking && (
        <div className="goal-link-picker">
          <div className="goal-link-targets" role="group" aria-label="What kind of work to link">
            {(["card", "sprint", "board"] as GoalLinkType[]).map((target) => (
              <button
                key={target}
                type="button"
                aria-pressed={linking.target === target}
                onClick={() => setLinking({ ...linking, target })}
              >
                {target}
              </button>
            ))}
          </div>
          <WorkPicker
            workspaceId={workspaceId}
            target={linking.target}
            onPick={addLink}
            onCancel={() => setLinking(null)}
          />
        </div>
      )}
    </section>
  );
}

/** The bar and the numbers behind it. Always both: a bar on its own invites guessing. */
function Progress({ goal }: { goal: Goal }) {
  return (
    <div className="goal-progress">
      <strong>{goal.has_evidence ? `${goal.percent}%` : "—"}</strong>
      <div
        className="progress"
        role="img"
        aria-label={
          goal.has_evidence
            ? `${goal.percent}% complete: ${goal.cards_done} of ${goal.cards_total} linked cards done`
            : "No linked work yet"
        }
      >
        <span style={{ width: `${goal.has_evidence ? goal.percent : 0}%` }} />
      </div>
      <span className="goal-counts">
        {goal.cards_done} of {goal.cards_total} cards
      </span>
    </div>
  );
}

function Milestone({
  goal,
  milestone,
  index,
  mayWrite,
  busy,
  onChange,
  onLink,
}: {
  goal: Goal;
  milestone: GoalMilestone;
  index: number;
  mayWrite: boolean;
  busy: boolean;
  onChange: (work: () => Promise<Goal>) => Promise<void>;
  onLink: (target: GoalLinkType) => void;
}) {
  return (
    <li className="milestone">
      <div className="milestone-head">
        <span className="milestone-percent">{milestone.percent}%</span>
        <div className="milestone-identity">
          <strong>{milestone.title}</strong>
          <span className="milestone-meta">
            {milestone.cards_done} of {milestone.cards_total} cards
            {milestone.target_date ? ` · by ${shortDate(milestone.target_date)}` : ""}
          </span>
        </div>
        {mayWrite && (
          <span className="milestone-actions">
            <button type="button" onClick={() => onLink("card")} disabled={busy}>
              Link work
            </button>
            <button
              type="button"
              aria-label={`Move ${milestone.title} up`}
              disabled={busy || index === 0}
              onClick={() => onChange(() => api.updateMilestone(milestone.id, { position: index - 1 }))}
            >
              <Icon name="arrow-up" size="sm" />
            </button>
            <button
              type="button"
              aria-label={`Move ${milestone.title} down`}
              disabled={busy || index === goal.milestones.length - 1}
              onClick={() => onChange(() => api.updateMilestone(milestone.id, { position: index + 1 }))}
            >
              <Icon name="arrow-down" size="sm" />
            </button>
            <button
              type="button"
              aria-label={`Delete the milestone ${milestone.title}`}
              disabled={busy}
              onClick={() => onChange(() => api.deleteMilestone(milestone.id))}
            >
              <Icon name="trash-2" size="sm" />
            </button>
          </span>
        )}
      </div>
      <div className="progress milestone-bar">
        <span style={{ width: `${milestone.percent}%` }} />
      </div>
      {milestone.links.length > 0 && (
        <ul className="goal-links">
          {milestone.links.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              mayWrite={mayWrite}
              busy={busy}
              onRemove={() => onChange(() => api.removeGoalLink(link.id))}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** One piece of linked work. A link whose target is gone says so instead of looking fine. */
function LinkRow({
  link,
  mayWrite,
  busy,
  onRemove,
}: {
  link: GoalLink;
  mayWrite: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  const href = linkHref(link);
  const label = linkLabel(link);
  return (
    <li className={`goal-link${link.target_title ? "" : " dead"}`}>
      <span className="goal-link-type">{link.target_type}</span>
      {href && link.target_title ? (
        <Link href={href}>{label}</Link>
      ) : (
        <span>{label}</span>
      )}
      {mayWrite && (
        <button
          type="button"
          aria-label={`Unlink ${label}`}
          disabled={busy}
          onClick={onRemove}
        >
          <Icon name="x" size="sm" />
        </button>
      )}
    </li>
  );
}

/** A one-field inline form, so adding a step does not need a dialog. */
function AddMilestone({
  goal,
  busy,
  onAdd,
}: {
  goal: Goal;
  busy: boolean;
  onAdd: (work: () => Promise<Goal>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={busy}>
        Add milestone
      </button>
    );
  }
  return (
    <form
      className="milestone-add"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!title.trim()) return;
        await onAdd(() => api.addMilestone(goal.id, { title: title.trim() }));
        setTitle("");
        setOpen(false);
      }}
    >
      <label htmlFor={`milestone-${goal.id}`} className="sr-only">
        New milestone for {goal.title}
      </label>
      <input
        id={`milestone-${goal.id}`}
        value={title}
        autoFocus
        maxLength={200}
        placeholder="Milestone title"
        onChange={(event) => setTitle(event.target.value)}
      />
      <button type="submit" disabled={busy || !title.trim()}>
        Add
      </button>
      <button type="button" onClick={() => setOpen(false)} disabled={busy}>
        Cancel
      </button>
    </form>
  );
}

/** Create and edit share one form. On create it also takes the first milestones. */
function GoalForm({
  goal,
  busy,
  onCancel,
  onSubmit,
}: {
  goal?: Goal;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: {
    title: string;
    detail: string;
    starts_on: string | null;
    target_date: string | null;
    milestones?: string[];
    state?: GoalState;
  }) => void;
}) {
  const [title, setTitle] = useState(goal?.title ?? "");
  const [detail, setDetail] = useState(goal?.detail ?? "");
  const [startsOn, setStartsOn] = useState(goal?.starts_on ?? "");
  const [targetDate, setTargetDate] = useState(goal?.target_date ?? "");
  const [milestones, setMilestones] = useState("");
  const id = goal ? `goal-${goal.id}` : "goal-new";

  return (
    <form
      className="goal-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        onSubmit({
          title: title.trim(),
          detail: detail.trim(),
          starts_on: startsOn || null,
          target_date: targetDate || null,
          ...(goal
            ? {}
            : {
                milestones: milestones
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean),
              }),
        });
      }}
    >
      <label htmlFor={`${id}-title`}>
        Goal
        <input
          id={`${id}-title`}
          value={title}
          required
          maxLength={200}
          placeholder="Ship the beta to 10 teams"
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label htmlFor={`${id}-detail`}>
        What it means <span className="muted">(optional)</span>
        <textarea
          id={`${id}-detail`}
          value={detail}
          rows={2}
          maxLength={5000}
          onChange={(event) => setDetail(event.target.value)}
        />
      </label>
      <div className="goal-form-dates">
        <label htmlFor={`${id}-start`}>
          Starts
          <input
            id={`${id}-start`}
            type="date"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
          />
        </label>
        <label htmlFor={`${id}-target`}>
          Target
          <input
            id={`${id}-target`}
            type="date"
            value={targetDate}
            onChange={(event) => setTargetDate(event.target.value)}
          />
        </label>
      </div>
      {!goal && (
        <label htmlFor={`${id}-milestones`}>
          Milestones <span className="muted">(one per line, optional)</span>
          <textarea
            id={`${id}-milestones`}
            value={milestones}
            rows={3}
            placeholder={"Onboarding works\nBilling is live"}
            onChange={(event) => setMilestones(event.target.value)}
          />
        </label>
      )}
      <div className="habit-form-actions">
        <button type="submit" className="primary" disabled={busy || !title.trim()}>
          {goal ? "Save goal" : "Set goal"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
