import type { Board, Card, Column } from "@/lib/types/board";

/**
 * Pure, immutable board updates used for optimistic UI. They mirror the backend's rules:
 * positions are contiguous 0..n-1, an out-of-range position clamps to the end.
 */
const renumber = <T extends { position: number }>(items: T[]): T[] =>
  items.map((item, position) => ({ ...item, position }));

export function findCard(board: Board, cardId: number): { card: Card; column: Column } | null {
  for (const column of board.columns) {
    const card = column.cards.find((c) => c.id === cardId);
    if (card) return { card, column };
  }
  return null;
}

export function moveCard(board: Board, cardId: number, columnId: number, position: number): Board {
  const found = findCard(board, cardId);
  if (!found || !board.columns.some((c) => c.id === columnId)) return board;
  const moving = { ...found.card, column_id: columnId };
  return {
    ...board,
    columns: board.columns.map((column) => {
      const cards = column.cards.filter((c) => c.id !== cardId);
      if (column.id === columnId) {
        cards.splice(Math.min(Math.max(position, 0), cards.length), 0, moving);
      }
      return column.id === columnId || column.id === found.column.id
        ? { ...column, cards: renumber(cards) }
        : column;
    }),
  };
}

export function moveColumn(board: Board, columnId: number, position: number): Board {
  const columns = board.columns.filter((c) => c.id !== columnId);
  const moving = board.columns.find((c) => c.id === columnId);
  if (!moving) return board;
  columns.splice(Math.min(Math.max(position, 0), columns.length), 0, moving);
  return { ...board, columns: renumber(columns) };
}

export function updateColumn(board: Board, columnId: number, patch: Partial<Column>): Board {
  return { ...board, columns: board.columns.map((c) => (c.id === columnId ? { ...c, ...patch } : c)) };
}

export function updateCard(board: Board, cardId: number, patch: Partial<Card>): Board {
  return {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      cards: column.cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c)),
    })),
  };
}

export function addColumn(board: Board, column: Column): Board {
  return { ...board, columns: renumber([...board.columns, column]) };
}

export function addCard(board: Board, card: Card): Board {
  return {
    ...board,
    columns: board.columns.map((column) =>
      column.id === card.column_id ? { ...column, cards: renumber([...column.cards, card]) } : column,
    ),
  };
}

export function removeCard(board: Board, cardId: number): Board {
  return {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      cards: renumber(column.cards.filter((c) => c.id !== cardId)),
    })),
  };
}

/** Remove a column; its cards are appended to `moveCardsTo` or dropped. */
export function removeColumn(board: Board, columnId: number, moveCardsTo?: number): Board {
  const removed = board.columns.find((c) => c.id === columnId);
  if (!removed) return board;
  const columns = board.columns
    .filter((c) => c.id !== columnId)
    .map((c) =>
      c.id === moveCardsTo
        ? { ...c, cards: renumber([...c.cards, ...removed.cards.map((k) => ({ ...k, column_id: c.id }))]) }
        : c,
    );
  return { ...board, columns: renumber(columns) };
}
