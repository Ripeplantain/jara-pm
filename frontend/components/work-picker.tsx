"use client";

import { useEffect, useState } from "react";
import { api, RequestError } from "@/lib/api/browser";
import type { BoardSummary, CardHit } from "@/lib/types/board";
import type { Sprint } from "@/lib/types/sprint";

export interface WorkChoice {
  cardId?: number;
  boardId?: number;
  sprintId?: number;
  title: string;
}

/**
 * Picks a piece of work: a card, a board or a sprint.
 *
 * Shared by the two surfaces that point at board work from outside it - a page's embed block
 * and a goal's link - because both need exactly the same question answered. Notes ask for cards
 * and boards; goals also ask for sprints.
 *
 * Cards are found with the workspace search the command palette already uses, rather than
 * walking boards and columns: typing two words is faster than three menus, and it reuses an
 * endpoint that already scopes results to this workspace. A sprint belongs to a board, so
 * picking one is two steps - the board, then its sprints.
 */
export function WorkPicker({
  workspaceId,
  target,
  onPick,
  onCancel,
}: {
  workspaceId: number;
  target: "card" | "board" | "sprint";
  onPick: (choice: WorkChoice) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<CardHit[]>([]);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [board, setBoard] = useState<BoardSummary | null>(null);
  // Boards load on mount for both board and sprint targets, so this starts busy rather than
  // being switched on inside the effect.
  const [busy, setBusy] = useState(target !== "card");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target === "card") return;
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

  async function pickBoard(chosen: BoardSummary) {
    if (target === "board") return onPick({ boardId: chosen.id, title: chosen.title });
    setBusy(true);
    setError(null);
    try {
      setBoard(chosen);
      setSprints(await api.listSprints(chosen.id));
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Couldn’t load sprints.");
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
      ) : board ? (
        <>
          <p className="menu-label">Sprints on {board.title}</p>
          <ul className="embed-picker-results">
            {sprints.map((sprint) => (
              <li key={sprint.id}>
                <button type="button" onClick={() => onPick({ sprintId: sprint.id, title: sprint.name })}>
                  <strong>{sprint.name}</strong>
                  <span>{sprint.state}</span>
                </button>
              </li>
            ))}
          </ul>
          {!busy && sprints.length === 0 && (
            <p className="muted">That board has no sprints yet.</p>
          )}
          <button type="button" className="ghost" onClick={() => setBoard(null)}>
            Pick another board
          </button>
        </>
      ) : (
        <>
          <p className="menu-label">{target === "sprint" ? "Which board is the sprint on?" : "Pick a board"}</p>
          <ul className="embed-picker-results">
            {boards.map((option) => (
              <li key={option.id}>
                <button type="button" onClick={() => pickBoard(option)}>
                  <strong>{option.title}</strong>
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
