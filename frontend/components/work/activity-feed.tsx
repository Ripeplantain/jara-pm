"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/shell/avatar";
import { api, RequestError } from "@/lib/api/browser";
import { longDateTime } from "@/lib/dates";
import type { Activity } from "@/lib/types/activity";
import type { BoardStat } from "@/lib/types/analytics";
import type { Member } from "@/lib/types/workspace";

const PAGE = 50;

/** The workspace's history, filterable by board and by who did it, paged backwards by id. */
export function ActivityFeed({
  workspaceId,
  initial,
  boards,
  members,
}: {
  workspaceId: number;
  initial: Activity[];
  boards: BoardStat[];
  members: Member[];
}) {
  const [entries, setEntries] = useState(initial);
  const [boardId, setBoardId] = useState<number | null>(null);
  const [actorId, setActorId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(initial.length < PAGE);
  const [error, setError] = useState<string | null>(null);

  async function load(nextBoard: number | null, nextActor: number | null, beforeId?: number) {
    setBusy(true);
    setError(null);
    try {
      const page = await api.workspaceActivity(workspaceId, {
        limit: PAGE,
        beforeId,
        boardId: nextBoard ?? undefined,
        actorId: nextActor ?? undefined,
      });
      setEntries((current) => (beforeId ? [...current, ...page] : page));
      setDone(page.length < PAGE);
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Could not load the activity feed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="filter-bar">
        <label>
          <span className="sr-only">Filter by board</span>
          <select
            value={boardId ?? ""}
            onChange={(e) => {
              const next = e.target.value ? Number(e.target.value) : null;
              setBoardId(next);
              void load(next, actorId);
            }}
          >
            <option value="">All boards</option>
            {boards.map((board) => (
              <option key={board.board_id} value={board.board_id}>
                {board.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by person</span>
          <select
            value={actorId ?? ""}
            onChange={(e) => {
              const next = e.target.value ? Number(e.target.value) : null;
              setActorId(next);
              void load(boardId, next);
            }}
          >
            <option value="">Anyone</option>
            {members.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.user.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="empty-state">No activity matches that filter yet.</p>
      ) : (
        <ul className="activity-feed">
          {entries.map((entry) => (
            <li key={entry.id}>
              {entry.actor ? (
                <Avatar user={entry.actor} size="sm" />
              ) : (
                <span className="avatar avatar-sm tint-slate" aria-hidden="true">
                  ?
                </span>
              )}
              <div>
                <p>
                  <span className="activity-actor">{entry.actor?.name ?? "Someone"}</span>{" "}
                  {entry.board_id ? (
                    <Link href={`/boards/${entry.board_id}${entry.card_id ? `?card=${entry.card_id}` : ""}`}>
                      {entry.summary}
                    </Link>
                  ) : (
                    entry.summary
                  )}
                </p>
                <span className="activity-time">{longDateTime(entry.created_at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!done && entries.length > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() => load(boardId, actorId, entries[entries.length - 1].id)}
        >
          {busy ? "Loading…" : "Load older"}
        </button>
      )}
    </>
  );
}
