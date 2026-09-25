import type { Card, Column } from "@/lib/types/board";

/** Handlers BoardView passes down; every one persists through the mutation queue. */
export interface BoardActions {
  renameColumn: (columnId: number, title: string) => void;
  moveColumnTo: (columnId: number, position: number) => void;
  requestDeleteColumn: (column: Column) => void;
  addCard: (columnId: number, title: string) => Promise<void>;
  editCard: (card: Card) => void;
  moveCardTo: (cardId: number, columnId: number, position: number | "end") => void;
}
