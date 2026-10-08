import type { Filters } from "@/components/board/filter-bar";
import type { Board, Card } from "@/lib/types/board";

const WEEK = 7 * 24 * 60 * 60 * 1000;

export function matchesFilters(card: Card, filters: Filters, meId: number, now = Date.now()): boolean {
  const term = filters.q.trim().toLowerCase();
  if (term && !`${card.title} ${card.description}`.toLowerCase().includes(term)) return false;
  if (filters.onlyMine && card.assignee_id !== meId) return false;
  if (filters.assigneeId !== null && card.assignee_id !== filters.assigneeId) return false;
  if (filters.labelId !== null && !card.labels.some((l) => l.id === filters.labelId)) return false;
  if (filters.priority !== null && card.priority !== filters.priority) return false;
  if (filters.due !== "any") {
    if (!card.due_date || card.completed_at) return false;
    const due = new Date(card.due_date).getTime();
    if (filters.due === "overdue" && due >= now) return false;
    if (filters.due === "week" && (due < now || due > now + WEEK)) return false;
  }
  return true;
}

/**
 * The board as the filters leave it. Columns stay, so an empty column still shows its heading
 * and its "add card" form - hiding the column would make the board jump around while typing.
 */
export function applyFilters(board: Board, filters: Filters, meId: number): Board {
  return {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      cards: column.cards.filter((card) => matchesFilters(card, filters, meId)),
    })),
  };
}
