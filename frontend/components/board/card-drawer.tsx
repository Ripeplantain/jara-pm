"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/shell/avatar";
import { api, RequestError } from "@/lib/api/browser";
import { fromDateInput, longDateTime, toDateInput } from "@/lib/dates";
import type { Activity } from "@/lib/types/activity";
import type { Card, Column, Priority } from "@/lib/types/board";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/types/board";
import type { Comment } from "@/lib/types/card-detail";
import type { Label } from "@/lib/types/label";
import type { Sprint } from "@/lib/types/sprint";
import type { Member } from "@/lib/types/workspace";

const message = (err: unknown) =>
  err instanceof RequestError ? err.message : "Something went wrong. Please try again.";

interface Props {
  card: Card;
  column: Column | undefined;
  columns: Column[];
  members: Member[];
  labels: Label[];
  sprints: Sprint[];
  canWrite: boolean;
  meId: number;
  /** Anything the drawer changes is handed back so the board updates in place. */
  onCardChanged: (card: Card) => void;
  onArchived: (cardId: number) => void;
  onOpenCard: (card: Card) => void;
  onClose: () => void;
}

/**
 * Everything about one card. Fed by the board state it was opened from, so opening it costs no
 * round trip; only comments and activity (which the board does not hold) are fetched.
 */
export function CardDrawer({
  card,
  column,
  columns,
  members,
  labels,
  sprints,
  canWrite,
  meId,
  onCardChanged,
  onArchived,
  onOpenCard,
  onClose,
}: Props) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [comment, setComment] = useState("");
  const [newItem, setNewItem] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  // Escape closes; Tab is kept inside the panel while it is open.
  useEffect(() => {
    closeButton.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listComments(card.id), api.boardActivity(column?.board_id ?? 0, 100)])
      .then(([loadedComments, loadedActivity]) => {
        if (cancelled) return;
        setComments(loadedComments);
        setActivity(loadedActivity.filter((entry) => entry.card_id === card.id));
      })
      .catch(() => {
        if (!cancelled) {
          setComments([]);
          setActivity([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [card.id, column?.board_id]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const patch = (changes: Parameters<typeof api.updateCard>[1]) =>
    run(async () => onCardChanged(await api.updateCard(card.id, changes)));

  const toggleLabel = (label: Label) =>
    run(async () => {
      const has = card.labels.some((l) => l.id === label.id);
      onCardChanged(
        has
          ? await api.removeLabelFromCard(card.id, label.id)
          : await api.addLabelToCard(card.id, label.id),
      );
    });

  /** Checklist writes return the item; the card's progress counts come from re-reading it. */
  const changeChecklist = (fn: () => Promise<unknown>) =>
    run(async () => {
      await fn();
      onCardChanged(await api.updateCard(card.id, {}));
    });

  const readOnly = !canWrite;
  const boardCards = useMemo(() => columns.flatMap((entry) => entry.cards), [columns]);
  const blockers = boardCards.filter((entry) => {
    if (entry.id === card.id) return false;
    const entryColumn = columns.find((columnEntry) => columnEntry.id === entry.column_id);
    return entryColumn?.title.toLowerCase().includes("block") || entry.title.toLowerCase().includes("block");
  }).slice(0, 5);
  const related = boardCards.filter((entry) => {
    if (entry.id === card.id) return false;
    const sameSprint = card.sprint_id !== null && entry.sprint_id === card.sprint_id;
    const sharedLabel = entry.labels.some((label) => card.labels.some((current) => current.id === label.id));
    return sameSprint || sharedLabel;
  }).slice(0, 5);

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Card: ${card.title}`}
        ref={panel}
      >
        <header className="drawer-head">
          <span className="muted">{column?.title ?? "Card"}</span>
          <button type="button" ref={closeButton} onClick={onClose} aria-label="Close card">
            ✕
          </button>
        </header>

        {error && (
          <p role="alert" className="error-banner">
            {error}
          </p>
        )}

        <div className="drawer-body">
          <div className="drawer-main">
            <label className="sr-only" htmlFor="card-title">
              Card title
            </label>
            <input
              id="card-title"
              className="drawer-title"
              value={title}
              maxLength={300}
              readOnly={readOnly}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                const next = title.trim();
                if (!next) {
                  setTitle(card.title);
                } else if (next !== card.title) {
                  patch({ title: next });
                }
              }}
            />

            <label htmlFor="card-description">Description</label>
            <textarea
              id="card-description"
              rows={5}
              value={description}
              maxLength={10000}
              readOnly={readOnly}
              placeholder="What needs to happen, and how you will know it is done."
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => description !== card.description && patch({ description })}
            />

            {(blockers.length > 0 || related.length > 0) && (
              <section aria-labelledby="related-heading" className="drawer-section">
                <h3 id="related-heading">Related work</h3>
                {blockers.length > 0 && <p className="drawer-subheading">Possible blockers</p>}
                <ul className="related-cards">
                  {blockers.map((entry) => (
                    <li key={`blocker-${entry.id}`}>
                      <button type="button" onClick={() => onOpenCard(entry)}>{entry.title}</button>
                      <span>blocked signal</span>
                    </li>
                  ))}
                  {related.map((entry) => (
                    <li key={`related-${entry.id}`}>
                      <button type="button" onClick={() => onOpenCard(entry)}>{entry.title}</button>
                      <span>same sprint or label</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section aria-labelledby="checklist-heading" className="drawer-section">
              <h3 id="checklist-heading">
                Checklist{" "}
                {card.checklist_total > 0 && (
                  <span className="muted">
                    {card.checklist_done}/{card.checklist_total}
                  </span>
                )}
              </h3>
              {card.checklist_total > 0 && (
                <div
                  className="progress"
                  role="progressbar"
                  aria-valuenow={card.checklist_done}
                  aria-valuemin={0}
                  aria-valuemax={card.checklist_total}
                  aria-label="Checklist progress"
                >
                  <span
                    style={{ width: `${(card.checklist_done / card.checklist_total) * 100}%` }}
                  />
                </div>
              )}
              <ul className="checklist">
                {card.checklist.map((item) => (
                  <li key={item.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={item.done}
                        disabled={readOnly || busy}
                        onChange={(e) =>
                          changeChecklist(() =>
                            api.updateChecklistItem(item.id, { done: e.target.checked }),
                          )
                        }
                      />
                      <span className={item.done ? "done" : ""}>{item.text}</span>
                    </label>
                    {!readOnly && (
                      <button
                        type="button"
                        aria-label={`Delete “${item.text}”`}
                        disabled={busy}
                        onClick={() => changeChecklist(() => api.deleteChecklistItem(item.id))}
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {!readOnly && (
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const text = newItem.trim();
                    if (!text) return;
                    setNewItem("");
                    changeChecklist(() => api.addChecklistItem(card.id, text));
                  }}
                >
                  <label className="sr-only" htmlFor="new-checklist-item">
                    Add a checklist item
                  </label>
                  <input
                    id="new-checklist-item"
                    value={newItem}
                    maxLength={300}
                    placeholder="Add an item"
                    onChange={(e) => setNewItem(e.target.value)}
                  />
                  <button type="submit" disabled={!newItem.trim() || busy}>
                    Add
                  </button>
                </form>
              )}
            </section>

            <section aria-labelledby="comments-heading" className="drawer-section">
              <h3 id="comments-heading">Comments</h3>
              {comments === null && <p className="muted">Loading…</p>}
              {comments?.length === 0 && <p className="muted">No comments yet.</p>}
              <ul className="comments">
                {comments?.map((entry) => (
                  <li key={entry.id}>
                    <div className="comment-head">
                      {entry.author && <Avatar user={entry.author} size="sm" showName />}
                      <span className="muted">{longDateTime(entry.created_at)}</span>
                      {entry.edited && <span className="muted">· edited</span>}
                      {entry.author_id === meId && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await api.deleteComment(entry.id);
                              setComments((list) =>
                                list?.filter((c) => c.id !== entry.id) ?? null,
                              );
                              onCardChanged(await api.updateCard(card.id, {}));
                            })
                          }
                        >
                          Delete
                        </button>
                      )}
                    </div>
                    <p>{entry.body}</p>
                  </li>
                ))}
              </ul>
              {!readOnly && (
                <form
                  className="comment-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const body = comment.trim();
                    if (!body) return;
                    setComment("");
                    run(async () => {
                      const created = await api.addComment(card.id, body);
                      setComments((list) => [...(list ?? []), created]);
                      onCardChanged(await api.updateCard(card.id, {}));
                    });
                  }}
                >
                  <label className="sr-only" htmlFor="new-comment">
                    Add a comment
                  </label>
                  <textarea
                    id="new-comment"
                    rows={2}
                    value={comment}
                    maxLength={5000}
                    placeholder="Write a comment. Use @name to notify someone."
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <button type="submit" disabled={!comment.trim() || busy}>
                    Comment
                  </button>
                </form>
              )}
            </section>

            <section aria-labelledby="history-heading" className="drawer-section">
              <h3 id="history-heading">History</h3>
              {activity === null && <p className="muted">Loading…</p>}
              {activity?.length === 0 && <p className="muted">Nothing recorded yet.</p>}
              <ul className="activity-list">
                {activity?.map((entry) => (
                  <li key={entry.id}>
                    <span className="activity-actor">{entry.actor?.name ?? "Someone"}</span>{" "}
                    {entry.summary}
                    <span className="activity-time">{longDateTime(entry.created_at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <aside className="drawer-side">
            <div className="field">
              <label htmlFor="card-column">Column</label>
              <select
                id="card-column"
                value={card.column_id}
                disabled={readOnly || busy}
                onChange={(e) =>
                  run(async () => {
                    const target = Number(e.target.value);
                    const size = columns.find((c) => c.id === target)?.cards.length ?? 0;
                    onCardChanged(await api.moveCard(card.id, target, size));
                  })
                }
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="card-assignee">Assignee</label>
              <select
                id="card-assignee"
                value={card.assignee_id ?? ""}
                disabled={readOnly || busy}
                onChange={(e) =>
                  patch({ assignee_id: e.target.value ? Number(e.target.value) : null })
                }
              >
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.user.name}
                    {member.user_id === meId ? " (you)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="card-priority">Priority</label>
              <select
                id="card-priority"
                value={card.priority}
                disabled={readOnly || busy}
                onChange={(e) => patch({ priority: e.target.value as Priority })}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="card-due">Due date</label>
              <input
                id="card-due"
                type="date"
                value={toDateInput(card.due_date)}
                disabled={readOnly || busy}
                onChange={(e) => patch({ due_date: fromDateInput(e.target.value) })}
              />
            </div>

            <div className="field">
              <label htmlFor="card-estimate">Estimate (points)</label>
              <input
                id="card-estimate"
                type="number"
                min={0}
                max={1000}
                value={card.estimate ?? ""}
                disabled={readOnly || busy}
                onChange={(e) =>
                  patch({ estimate: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </div>

            {sprints.length > 0 && (
              <div className="field">
                <label htmlFor="card-sprint">Sprint</label>
                <select
                  id="card-sprint"
                  value={card.sprint_id ?? ""}
                  disabled={readOnly || busy}
                  onChange={(e) =>
                    run(async () =>
                      onCardChanged(
                        await api.setCardSprint(
                          card.id,
                          e.target.value ? Number(e.target.value) : null,
                        ),
                      ),
                    )
                  }
                >
                  <option value="">Backlog</option>
                  {sprints
                    .filter((s) => s.state !== "completed" || s.id === card.sprint_id)
                    .map((sprint) => (
                      <option key={sprint.id} value={sprint.id}>
                        {sprint.name}
                      </option>
                    ))}
                </select>
              </div>
            )}

            <fieldset className="field">
              <legend>Labels</legend>
              {labels.length === 0 ? (
                <p className="field-hint">
                  No labels in this workspace yet. Add them in workspace settings.
                </p>
              ) : (
                <div className="label-choices">
                  {labels.map((label) => {
                    const on = card.labels.some((l) => l.id === label.id);
                    return (
                      <button
                        key={label.id}
                        type="button"
                        className={`label-chip tint-${label.color}${on ? " chosen" : ""}`}
                        aria-pressed={on}
                        disabled={readOnly || busy}
                        onClick={() => toggleLabel(label)}
                      >
                        {label.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </fieldset>

            <dl className="card-meta">
              <dt>Created</dt>
              <dd>{longDateTime(card.created_at)}</dd>
              {card.completed_at && (
                <>
                  <dt>Completed</dt>
                  <dd>{longDateTime(card.completed_at)}</dd>
                </>
              )}
            </dl>

            {!readOnly && (
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.archiveCard(card.id);
                    onArchived(card.id);
                  })
                }
              >
                Archive card
              </button>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
