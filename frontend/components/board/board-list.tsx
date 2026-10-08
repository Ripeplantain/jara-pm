"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Modal } from "@/components/board/modal";
import { api, RequestError } from "@/lib/api/browser";
import type { BoardStat } from "@/lib/types/analytics";
import type { BoardTemplate } from "@/lib/types/board";
import { canWrite } from "@/lib/types/workspace";
import type { Role } from "@/lib/types/workspace";

/**
 * The boards dashboard. Favourites sort first (the backend already orders them that way);
 * search narrows in the browser because the list is small and instant beats correct-to-the-ms.
 */
export function BoardList({
  boards,
  templates,
  role,
  workspaceId,
}: {
  boards: BoardStat[];
  templates: BoardTemplate[];
  role: Role;
  workspaceId: number;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState<BoardStat | null>(null);
  const mayWrite = canWrite(role);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? boards.filter((b) => b.title.toLowerCase().includes(term)) : boards;
  }, [boards, search]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    run(async () => {
      const board = await api.createBoard(trimmed, ["To do", "In progress", "Done"], workspaceId);
      setTitle("");
      router.push(`/boards/${board.id}`);
      router.refresh();
    });
  };

  const fromTemplate = (key: string) =>
    run(async () => {
      const board = await api.createBoardFromTemplate(key, undefined, workspaceId);
      setPicking(false);
      router.push(`/boards/${board.id}`);
      router.refresh();
    });

  const toggleFavorite = (board: BoardStat) =>
    run(async () => {
      await api.setFavorite(board.board_id, !board.is_favorite);
      router.refresh();
    });

  return (
    <section aria-labelledby="boards-heading">
      <div className="section-heading">
        <h2 id="boards-heading">Boards</h2>
        <label className="board-search">
          <span className="sr-only">Search boards</span>
          <input
            type="search"
            value={search}
            placeholder="Search boards"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      {mayWrite ? (
        <div className="board-create-panel">
          <div className="create-copy">
            <strong>Start something new</strong>
            <span>A blank board, or one of five ready-made layouts.</span>
          </div>
          <form className="board-create-form" onSubmit={create}>
            <label htmlFor="new-board">Board title</label>
            <input
              id="new-board"
              value={title}
              maxLength={200}
              placeholder="e.g. Q3 roadmap"
              onChange={(e) => setTitle(e.target.value)}
            />
            <button type="submit" disabled={busy || !title.trim()}>
              Create
            </button>
            <button type="button" onClick={() => setPicking(true)} disabled={busy}>
              Use a template
            </button>
          </form>
        </div>
      ) : (
        <p className="muted notice">
          You have view-only access to this workspace, so you cannot create boards here.
        </p>
      )}

      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}

      {boards.length === 0 ? (
        <p className="empty-state">
          No boards here yet.{" "}
          {mayWrite ? "Create one above to get started." : "Ask an admin to add one."}
        </p>
      ) : shown.length === 0 ? (
        <p className="empty-state">No board matches “{search}”.</p>
      ) : (
        <ul className="board-list">
          {shown.map((board) => (
            <li key={board.board_id} className="board-card">
              <button
                type="button"
                className="fav-button"
                aria-pressed={board.is_favorite}
                aria-label={
                  board.is_favorite
                    ? `Remove ${board.title} from favourites`
                    : `Add ${board.title} to favourites`
                }
                onClick={() => toggleFavorite(board)}
              >
                <span aria-hidden="true">{board.is_favorite ? "★" : "☆"}</span>
              </button>
              <Link href={`/boards/${board.board_id}`} className="board-card-link">
                <h3>{board.title}</h3>
              </Link>
              <p className="board-card-meta">
                <span>
                  <strong>{board.open_cards}</strong> open
                </span>
                <span>
                  <strong>{board.total_cards}</strong> total
                </span>
                {board.overdue > 0 && (
                  <span className="pill pill-danger">{board.overdue} overdue</span>
                )}
              </p>
              <div className="board-card-actions">
                <Link href={`/boards/${board.board_id}/insights`}>Insights</Link>
                {mayWrite && (
                  <button type="button" onClick={() => setConfirming(board)}>
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {picking && (
        <Modal label="Choose a template" onClose={() => setPicking(false)}>
          <h2>Start from a template</h2>
          <p className="muted">Each one sets up its own columns, labels and done column.</p>
          <ul className="template-list">
            {templates.map((template) => (
              <li key={template.key}>
                <button type="button" onClick={() => fromTemplate(template.key)} disabled={busy}>
                  <strong>{template.name}</strong>
                  <span>{template.description}</span>
                  <span className="template-columns">{template.columns.join(" › ")}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="row-actions">
            <button type="button" onClick={() => setPicking(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {confirming && (
        <Modal label="Delete board" onClose={() => setConfirming(null)}>
          <h2>Delete “{confirming.title}”?</h2>
          <p>
            This removes the board and all {confirming.total_cards} of its cards for everyone in
            the workspace. It cannot be undone.
          </p>
          <div className="row-actions">
            <button
              type="button"
              className="danger"
              onClick={() => {
                const board = confirming;
                setConfirming(null);
                run(async () => {
                  await api.deleteBoard(board.board_id);
                  router.refresh();
                });
              }}
            >
              Delete board
            </button>
            <button type="button" onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
