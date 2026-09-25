/** Mirror backend schemas in backend/app/schemas/boards.py. */
export interface Card {
  id: number;
  column_id: number;
  title: string;
  description: string;
  position: number;
  created_at: string;
}

export interface Column {
  id: number;
  board_id: number;
  title: string;
  position: number;
  cards: Card[];
}

export interface BoardSummary {
  id: number;
  title: string;
  created_at: string;
}

export interface Board extends BoardSummary {
  columns: Column[];
}
