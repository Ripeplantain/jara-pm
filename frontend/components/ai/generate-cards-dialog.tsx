"use client";

import { useState } from "react";
import { Modal } from "@/components/board/modal";
import { Skeleton, SkeletonLabel } from "@/components/shell/skeleton";
import { api, RequestError } from "@/lib/api/browser";
import { shortDate } from "@/lib/dates";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/types/board";
import type { Board, CardDraft, Priority } from "@/lib/types/board";
import type { Label } from "@/lib/types/label";
import type { Member } from "@/lib/types/workspace";

const MAX_TEXT = 12000;

interface Row {
  key: number;
  keep: boolean;
  draft: CardDraft;
}

interface Props {
  board: Board;
  members: Member[];
  labels: Label[];
  /** The board as the server returned it once the kept drafts were created. */
  onCreated: (board: Board) => void;
  onClose: () => void;
}

const message = (err: unknown, fallback: string) => (err instanceof RequestError ? err.message : fallback);

/**
 * Paste text, review what the assistant drafted, create the cards you keep. Drafting writes
 * nothing: the cards only exist once the user submits the review step.
 */
export function GenerateCardsDialog({ board, members, labels, onCreated, onClose }: Props) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState("");
  const [columnId, setColumnId] = useState(board.columns[0]?.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kept = rows?.filter((row) => row.keep && row.draft.title.trim()) ?? [];

  async function draft() {
    setBusy(true);
    setError(null);
    setNote("");
    try {
      const res = await api.draftCards(board.id, text.trim());
      if (res.drafts.length) setRows(res.drafts.map((d, key) => ({ key, keep: true, draft: d })));
      else setNote(res.note || "Nothing in that text looked like work to track.");
    } catch (err) {
      setError(message(err, "The assistant failed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (columnId === undefined || !kept.length) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createCards(columnId, kept.map((row) => ({ ...row.draft, title: row.draft.title.trim() }))));
    } catch (err) {
      setError(message(err, "Couldn't create the cards. Please try again."));
      setBusy(false);
    }
  }

  function setKeep(key: number, keep: boolean) {
    setRows((prev) => prev?.map((row) => (row.key === key ? { ...row, keep } : row)) ?? null);
  }

  function edit(key: number, change: Partial<CardDraft>) {
    setRows(
      (prev) => prev?.map((row) => (row.key === key ? { ...row, draft: { ...row.draft, ...change } } : row)) ?? null,
    );
  }

  const memberName = (id: number | null) => members.find((m) => m.user_id === id)?.user.name;

  return (
    <Modal label="Generate cards from text" className="draft-dialog" onClose={onClose}>
      {rows === null ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() && !busy) void draft();
          }}
        >
          <h2>Generate cards</h2>
          <p>
            Paste a brief, spec, meeting notes or a description of what you want built. Kobi drafts
            the cards and you choose which ones to create.
          </p>
          <label htmlFor="draft-text">Text to turn into cards</label>
          <textarea
            id="draft-text"
            rows={10}
            maxLength={MAX_TEXT}
            placeholder="Paste here…"
            value={text}
            disabled={busy}
            autoFocus
            onChange={(e) => setText(e.target.value)}
          />
          <p className="field-hint draft-count" aria-live="polite">
            {text.length.toLocaleString()}/{MAX_TEXT.toLocaleString()}
          </p>
          {note && <p role="status">{note}</p>}
          {error && <p role="alert" className="draft-error">{error}</p>}
          {busy && (
            <Skeleton
              rows={2}
              className="skeleton-block--compact"
              label="Drafting cards"
            />
          )}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !text.trim()} aria-label={busy ? "Drafting cards" : undefined}>
              {busy ? <SkeletonLabel className="skeleton-label--wide" /> : "Draft cards"}
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void create();
          }}
        >
          <h2>Review {rows.length === 1 ? "1 drafted card" : `${rows.length} drafted cards`}</h2>
          <p>Nothing has been created yet. Untick or edit anything before adding it to the board.</p>
          <ul className="draft-list">
            {rows.map(({ key, keep, draft: d }) => (
              <li key={key} className={keep ? "draft-row" : "draft-row skipped"}>
                <input
                  type="checkbox"
                  checked={keep}
                  aria-label={`Create “${d.title}”`}
                  onChange={(e) => setKeep(key, e.target.checked)}
                />
                <div className="draft-body">
                  <input
                    type="text"
                    value={d.title}
                    maxLength={300}
                    disabled={!keep}
                    aria-label="Card title"
                    onChange={(e) => edit(key, { title: e.target.value })}
                  />
                  <p className="draft-meta">
                    <select
                      value={d.priority}
                      disabled={!keep}
                      aria-label="Priority"
                      onChange={(e) => edit(key, { priority: e.target.value as Priority })}
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {PRIORITY_LABEL[p]}
                        </option>
                      ))}
                    </select>
                    {memberName(d.assignee_id) && <span className="chip">{memberName(d.assignee_id)}</span>}
                    {d.due_date && <span className="chip">Due {shortDate(d.due_date)}</span>}
                    {d.estimate !== null && <span className="chip">{d.estimate} pts</span>}
                    {d.checklist.length > 0 && (
                      <span className="chip">
                        {d.checklist.length} checklist {d.checklist.length === 1 ? "item" : "items"}
                      </span>
                    )}
                    {labels
                      .filter((label) => d.label_ids.includes(label.id))
                      .map((label) => (
                        <span key={label.id} className={`label-chip tint-${label.color}`}>
                          {label.name}
                        </span>
                      ))}
                  </p>
                  {(d.description || d.checklist.length > 0) && (
                    <details>
                      <summary>Details</summary>
                      {d.description && <p className="draft-description">{d.description}</p>}
                      {d.checklist.length > 0 && (
                        <ul>
                          {d.checklist.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      )}
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <label htmlFor="draft-column">Add to column</label>
          <select
            id="draft-column"
            value={columnId}
            disabled={busy}
            onChange={(e) => setColumnId(Number(e.target.value))}
          >
            {board.columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          {error && <p role="alert" className="draft-error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={() => setRows(null)}>
              Back
            </button>
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !kept.length} aria-label={busy ? "Creating cards" : undefined}>
              {busy ? <SkeletonLabel className="skeleton-label--wide" /> : `Create ${kept.length === 1 ? "1 card" : `${kept.length} cards`}`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
