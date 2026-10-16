"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { api, RequestError } from "@/lib/api/browser";
import { flatten, noteTitle, toTree } from "@/lib/types/note";
import type { NoteSummary } from "@/lib/types/note";
import { canWrite } from "@/lib/types/workspace";
import type { Role } from "@/lib/types/workspace";

interface Props {
  workspaceId: number;
  role: Role;
  initial: NoteSummary[];
  meId: number;
}

/**
 * The page tree.
 *
 * Reordering and re-nesting are explicit controls rather than drag and drop: a tree drop target
 * has to infer both a parent and a position, and a wrong guess silently moves someone's page
 * into another page. The buttons say exactly what they do and work from the keyboard.
 */
export function NotesIndex({ workspaceId, role, initial, meId }: Props) {
  const router = useRouter();
  const [notes, setNotes] = useState(initial);
  const [showArchived, setShowArchived] = useState(false);
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

  async function reload(archived = showArchived) {
    const fresh = await run(() => api.listNotes(workspaceId, archived));
    if (fresh) setNotes(fresh);
  }

  async function create(parentId: number | null) {
    const page = await run(() => api.createNote(workspaceId, { parent_id: parentId }));
    if (page) router.push(`/notes/${page.id}`);
  }

  /** `position` counts the siblings you can see, which is what the tree draws. */
  async function move(note: NoteSummary, delta: number) {
    const siblings = notes.filter((n) => n.parent_id === note.parent_id && !n.archived_at);
    const index = siblings.findIndex((n) => n.id === note.id);
    const target = index + delta;
    if (target < 0 || target >= siblings.length) return;
    await run(() => api.moveNote(note.id, { position: target }));
    await reload();
  }

  /** Nest the page under the sibling above it, or lift it back out to its grandparent. */
  async function renest(note: NoteSummary, direction: "in" | "out") {
    const siblings = notes.filter((n) => n.parent_id === note.parent_id && !n.archived_at);
    const index = siblings.findIndex((n) => n.id === note.id);
    if (direction === "in") {
      if (index <= 0) return;
      await run(() => api.moveNote(note.id, { parent_id: siblings[index - 1].id }));
    } else {
      if (note.parent_id === null) return;
      const parent = notes.find((n) => n.id === note.parent_id);
      await run(() => api.moveNote(note.id, { parent_id: parent?.parent_id ?? null }));
    }
    await reload();
  }

  const rows = flatten(toTree(notes.filter((n) => showArchived || !n.archived_at)));

  return (
    <section className="notes-index">
      <div className="notes-index-bar">
        {mayWrite ? (
          <button type="button" className="primary" onClick={() => create(null)} disabled={busy}>
            <Icon name="plus" size="sm" /> New page
          </button>
        ) : (
          <p className="muted">Your role is read-only, so you can read pages but not write them.</p>
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

      {rows.length === 0 ? (
        <div className="empty-state">
          <strong>No pages yet</strong>
          <span>
            Write the things a card cannot hold: a spec, meeting notes, research, a plan. Pages
            are shared with the workspace unless you mark them private.
          </span>
        </div>
      ) : (
        <ul className="note-tree">
          {rows.map((note) => (
            <li
              key={note.id}
              className="note-row"
              style={{ "--note-depth": note.depth } as React.CSSProperties}
            >
              <Link href={`/notes/${note.id}`} className="note-row-link">
                <span className="note-row-icon" aria-hidden="true">
                  {note.icon || <Icon name="file-text" size="sm" />}
                </span>
                <span className="note-row-title">{noteTitle(note)}</span>
                {note.visibility === "private" && (
                  <span className="note-badge">
                    <Icon name="lock" size="sm" title="Private to you" />
                    Private
                  </span>
                )}
                {note.archived_at && <span className="note-badge">Archived</span>}
                {note.owner && note.owner.id !== meId && (
                  <span className="note-row-owner">{note.owner.name}</span>
                )}
              </Link>
              {mayWrite && !note.archived_at && (
                <span className="note-row-actions">
                  <button
                    type="button"
                    aria-label={`Move ${noteTitle(note)} up`}
                    onClick={() => move(note, -1)}
                    disabled={busy}
                  >
                    <Icon name="arrow-up" size="sm" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${noteTitle(note)} down`}
                    onClick={() => move(note, 1)}
                    disabled={busy}
                  >
                    <Icon name="arrow-down" size="sm" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Nest ${noteTitle(note)} under the page above`}
                    onClick={() => renest(note, "in")}
                    disabled={busy}
                  >
                    <Icon name="arrow-right" size="sm" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${noteTitle(note)} out one level`}
                    onClick={() => renest(note, "out")}
                    disabled={busy || note.parent_id === null}
                  >
                    <Icon name="arrow-left" size="sm" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Add a subpage under ${noteTitle(note)}`}
                    onClick={() => create(note.id)}
                    disabled={busy}
                  >
                    <Icon name="plus" size="sm" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
