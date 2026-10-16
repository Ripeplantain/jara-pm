"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/board/modal";
import { Icon } from "@/components/icon";
import { NoteEditor } from "@/components/notes/note-editor";
import { api, RequestError } from "@/lib/api/browser";
import { noteTitle } from "@/lib/types/note";
import type { Note, NoteSummary } from "@/lib/types/note";
import { canAdminister, canWrite } from "@/lib/types/workspace";
import type { Role } from "@/lib/types/workspace";

const TITLE_DELAY = 700;

/**
 * One page: its heading, its body, and its subpages.
 *
 * The visibility control is deliberately not role-gated the way the rest of the app is: a page's
 * audience is its author's call, so only the owner sees it, and an admin cannot un-private
 * somebody else's page even though they can delete it.
 */
export function NotePage({
  note,
  role,
  meId,
  parent,
  subpages,
}: {
  note: Note;
  role: Role;
  meId: number;
  /** The page this one sits in, for the breadcrumb. */
  parent: NoteSummary | null;
  /** Subpages of this page, already filtered to what the reader can see. */
  subpages: NoteSummary[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(note.title);
  const [visibility, setVisibility] = useState(note.visibility);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleDirty = useRef(false);

  const mayWrite = canWrite(role);
  const isOwner = note.owner?.id === meId;
  const mayDelete = isOwner || canAdminister(role);

  // The title saves on its own, like the body.
  useEffect(() => {
    if (!mayWrite || !titleDirty.current) return;
    const timer = setTimeout(async () => {
      try {
        await api.updateNote(note.id, { title });
        titleDirty.current = false;
      } catch (err) {
        setError(err instanceof RequestError ? err.message : "Couldn’t save the title.");
      }
    }, TITLE_DELAY);
    return () => clearTimeout(timer);
  }, [title, mayWrite, note.id]);

  async function run(work: () => Promise<unknown>, then?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await work();
      then?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleVisibility() {
    const next = visibility === "private" ? "workspace" : "private";
    await run(
      () => api.setNoteVisibility(note.id, next),
      () => setVisibility(next),
    );
  }

  async function remove() {
    setConfirming(false);
    await run(() => api.deleteNote(note.id), () => router.push("/notes"));
  }

  return (
    <article className="note-page">
      <header className="note-page-head">
        <nav aria-label="Breadcrumb" className="note-crumbs">
          <Link href="/notes">Notes</Link>
          {parent && (
            <>
              <span aria-hidden="true">/</span>
              <Link href={`/notes/${parent.id}`}>{noteTitle(parent)}</Link>
            </>
          )}
        </nav>

        <div className="note-title-row">
          <span className="note-title-icon" aria-hidden="true">
            {note.icon || <Icon name="file-text" size="lg" />}
          </span>
          {mayWrite ? (
            <input
              className="note-title-input"
              value={title}
              placeholder="Untitled"
              aria-label="Page title"
              onChange={(event) => {
                titleDirty.current = true;
                setTitle(event.target.value);
              }}
            />
          ) : (
            <h1 className="note-title-input">{noteTitle({ title })}</h1>
          )}
        </div>

        <div className="note-page-meta">
          <span className={`note-badge${visibility === "private" ? " private" : ""}`}>
            <Icon name={visibility === "private" ? "lock" : "globe"} size="sm" />
            {visibility === "private" ? "Private to you" : "Visible to the workspace"}
          </span>
          {note.owner && <span className="muted">Written by {note.owner.name}</span>}
          {note.archived_at && <span className="note-badge">Archived</span>}
        </div>

        {mayWrite && (
          <div className="note-page-actions">
            {isOwner && (
              <button type="button" onClick={toggleVisibility} disabled={busy}>
                <Icon name={visibility === "private" ? "globe" : "lock"} size="sm" />
                {visibility === "private" ? "Share with the workspace" : "Make private"}
              </button>
            )}
            <button
              type="button"
              onClick={() => run(() => api.createNote(note.workspace_id, { parent_id: note.id }))}
              disabled={busy}
            >
              <Icon name="plus" size="sm" /> Add a subpage
            </button>
            {note.archived_at ? (
              <button type="button" onClick={() => run(() => api.unarchiveNote(note.id))} disabled={busy}>
                <Icon name="archive" size="sm" /> Restore
              </button>
            ) : (
              <button type="button" onClick={() => run(() => api.archiveNote(note.id))} disabled={busy}>
                <Icon name="archive" size="sm" /> Archive
              </button>
            )}
            {mayDelete && (
              <button type="button" className="danger" onClick={() => setConfirming(true)} disabled={busy}>
                <Icon name="trash-2" size="sm" /> Delete
              </button>
            )}
          </div>
        )}
      </header>

      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}

      {confirming && (
        <Modal label="Delete page" onClose={() => setConfirming(false)}>
          <h2>Delete “{noteTitle(note)}”?</h2>
          <p>
            {subpages.length > 0
              ? `This removes the page, its ${subpages.length} subpage${subpages.length === 1 ? "" : "s"} and everything written on them.`
              : "This removes the page and everything written on it."}{" "}
            It cannot be undone. Archiving it instead keeps it out of the way and restorable.
          </p>
          <div className="row-actions">
            <button type="button" className="danger" onClick={remove} disabled={busy}>
              Delete the page
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      <NoteEditor note={note} canEdit={mayWrite && !note.archived_at} workspaceId={note.workspace_id} />

      {subpages.length > 0 && (
        <section className="note-subpages">
          <h2>Subpages</h2>
          <ul>
            {subpages.map((child) => (
              <li key={child.id}>
                <Link href={`/notes/${child.id}`}>
                  <span aria-hidden="true">{child.icon || <Icon name="file-text" size="sm" />}</span>
                  {noteTitle(child)}
                  {child.visibility === "private" && (
                    <Icon name="lock" size="sm" title="Private to you" />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
