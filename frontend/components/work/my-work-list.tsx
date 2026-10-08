"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CardFace } from "@/components/board/card-face";
import { api, RequestError } from "@/lib/api/browser";
import { dueState } from "@/lib/dates";
import type { CardHit } from "@/lib/types/board";

type Bucket = "overdue" | "today" | "week" | "later" | "undated";

const ORDER: Bucket[] = ["overdue", "today", "week", "later", "undated"];
const HEADINGS: Record<Bucket, string> = {
  overdue: "Overdue",
  today: "Due today",
  week: "This week",
  later: "Later",
  undated: "No due date",
};

function bucketOf(card: CardHit): Bucket {
  if (!card.due_date) return "undated";
  const state = dueState(card.due_date, card.completed_at);
  if (state === "overdue") return "overdue";
  if (state === "today") return "today";
  if (state === "soon") return "week";
  return "later";
}

/**
 * Everything assigned to me across the workspace, grouped by how soon it is due. The quick
 * actions are the two that do not need the board's context: mark it done, or hand it back.
 */
export function MyWorkList({ cards: initial, meId }: { cards: CardHit[]; meId: number }) {
  const router = useRouter();
  const [cards, setCards] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const grouped = ORDER.map((bucket) => ({
    bucket,
    items: cards.filter((card) => bucketOf(card) === bucket),
  })).filter((group) => group.items.length > 0);

  async function unassign(card: CardHit) {
    setBusy(card.id);
    setError(null);
    try {
      await api.updateCard(card.id, { assignee_id: null });
      setCards((list) => list.filter((c) => c.id !== card.id));
      router.refresh();
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Could not update that card.");
    } finally {
      setBusy(null);
    }
  }

  if (cards.length === 0) {
    return (
      <p className="empty-state">
        Nothing is assigned to you in this workspace. Pick something up from a{" "}
        <Link href="/">board</Link>.
      </p>
    );
  }

  return (
    <>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {grouped.map((group) => (
        <section key={group.bucket} aria-labelledby={`bucket-${group.bucket}`} className="work-group">
          <h2 id={`bucket-${group.bucket}`} className={group.bucket === "overdue" ? "alarming" : ""}>
            {HEADINGS[group.bucket]} <span className="muted">{group.items.length}</span>
          </h2>
          <ul className="work-list">
            {group.items.map((card) => (
              <li key={card.id} className="work-card">
                <div className="work-card-main">
                  <Link href={`/boards/${card.board_id}?card=${card.id}`} className="work-card-title">
                    {card.title}
                  </Link>
                  <p className="muted">
                    {card.board_title} · {card.column_title}
                  </p>
                  <CardFace card={{ ...card, assignee: meId === card.assignee_id ? null : card.assignee }} />
                </div>
                <div className="work-card-actions">
                  <button type="button" disabled={busy === card.id} onClick={() => unassign(card)}>
                    Unassign me
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
