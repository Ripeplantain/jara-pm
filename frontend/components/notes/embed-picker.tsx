"use client";

import { useEffect, useState } from "react";
import { api, RequestError } from "@/lib/api/browser";
import type { BoardSummary, CardHit } from "@/lib/types/board";

export interface EmbedChoice {
  cardId?: number;
  boardId?: number;
  title: string;
}

/**
 * Picks the card or board a block embeds.
 *
 * Cards are found with the workspace search the command palette already uses, rather than
 * walking boards and columns: typing two words is faster than three menus, and it reuses an
 * endpoint that already scopes results to this workspace.
 */
export function EmbedPicker({
  workspaceId,
  target,
  onPick,
  onCancel,
}: {
  workspaceId: number;
  target: "card" | "board";
  onPick: (choice: EmbedChoice) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<CardHit[]>([]);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  // Boards load on mount, so this starts busy rather than being switched on inside the effect.
  const [busy, setBusy] = useState(target === "board");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target !== "board") return;
    let live = true;
    api
      .listBoards(workspaceId)
      .then((found) => live && setBoards(found))
      .catch((err) => live && setError(err instanceof RequestError ? err.message : "Couldn’t load boards."))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [target, workspaceId]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setCards((await api.search(workspaceId, query.trim())).cards);
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Search is unavailable.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="embed-picker">
      {target === "card" ? (
        <>
          <form onSubmit={search}>
            <label htmlFor="embed-search">Find a card</label>
            <input
              id="embed-search"
              value={query}
              autoFocus
              placeholder="Card title or keyword…"
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="submit" disabled={busy || !query.trim()}>
              Search
            </button>
          </form>
          {cards.length > 0 && (
            <ul className="embed-picker-results">
              {cards.map((card) => (
                <li key={card.id}>
                  <button type="button" onClick={() => onPick({ cardId: card.id, title: card.title })}>
                    <strong>{card.title}</strong>
                    <span>
                      {card.board_title} · {card.column_title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!busy && !error && query.trim() && cards.length === 0 && (
            <p className="muted">No card matches that.</p>
          )}
        </>
      ) : (
        <>
          <p className="menu-label">Pick a board</p>
          <ul className="embed-picker-results">
            {boards.map((board) => (
              <li key={board.id}>
                <button type="button" onClick={() => onPick({ boardId: board.id, title: board.title })}>
                  <strong>{board.title}</strong>
                </button>
              </li>
            ))}
          </ul>
          {!busy && boards.length === 0 && <p className="muted">There are no boards here yet.</p>}
        </>
      )}
      {error && (
        <p className="search-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="ghost" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
