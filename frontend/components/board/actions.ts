import type { Card, Column } from "@/lib/types/board";

/** Handlers BoardView passes down; every one persists through the mutation queue. */
export interface BoardActions {
  renameColumn: (columnId: number, title: string) => void;
  moveColumnTo: (columnId: number, position: number) => void;
  updateColumnSettings: (
    columnId: number,
    patch: { wip_limit?: number | null; is_done?: boolean },
  ) => void;
  requestDeleteColumn: (column: Column) => void;
  addCard: (columnId: number, title: string) => Promise<void>;
  /** Opens the detail drawer, which is also where a card is edited. */
  openCard: (card: Card) => void;
  moveCardTo: (cardId: number, columnId: number, position: number | "end") => void;
  /** True when the viewer may change anything; viewers get a read-only board. */
  canWrite: boolean;
}
