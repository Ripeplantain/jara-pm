"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, RequestError } from "@/lib/api/browser";
import type { BoardSummary } from "@/lib/types/board";

export function BoardList({ boards }: { boards: BoardSummary[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section aria-labelledby="boards-heading">
      <div className="section-heading">
        <h2 id="boards-heading">All boards</h2>
        <span>{boards.length === 0 ? "Ready when you are" : "Your private workspace"}</span>
      </div>
      <form
        className="board-create-panel"
        onSubmit={(e) => {
          e.preventDefault();
          const t = title.trim();
          if (!t) return;
          run(async () => {
            const board = await api.createBoard(t, ["To do", "In progress", "Done"]);
            router.push(`/boards/${board.id}`);
          });
        }}
      >
        <div className="create-copy">
          <strong>Start something new</strong>
          <span>Give your next project a home and make progress visible.</span>
        </div>
        <div className="board-create-form">
          <label htmlFor="new-board-title">Board name</label>
          <input
            id="new-board-title"
            value={title}
            maxLength={200}
            placeholder="e.g. Product launch"
            onChange={(e) => setTitle(e.target.value)}
          />
          <button type="submit" disabled={busy || !title.trim()}>
            Create board
          </button>
        </div>
      </form>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {boards.length === 0 ? (
        <div className="empty-state">
          <strong>No boards yet</strong>
          <span>Create your first board above and turn a loose idea into a clear plan.</span>
        </div>
      ) : (
        <ul className="board-list">
          {boards.map((b) => (
            <li key={b.id} className="board-card">
              <Link className="board-card-link" href={`/boards/${b.id}`}>
                {b.title}
              </Link>
              <div className="board-card-meta">
                <span>Board workspace</span>
                <button
                  className="board-delete"
                  type="button"
                  disabled={busy}
                  aria-label={`Delete board ${b.title}`}
                  onClick={() => {
                    if (!window.confirm(`Delete board “${b.title}” and all its cards?`)) return;
                    run(async () => {
                      await api.deleteBoard(b.id);
                      router.refresh();
                    });
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
