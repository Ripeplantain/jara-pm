import type { Board, CardDraft } from "@/lib/types/board";

/** Mirror backend schemas in backend/app/schemas/ai.py. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AppliedChange {
  kind: string;
  summary: string;
  board_id: number;
  column_id: number | null;
  card_id: number | null;
}

export interface PendingAction {
  tool: string;
  summary: string;
  board_id: number;
  column_id: number | null;
  card_id: number | null;
  move_cards_to: number | null;
  delete_cards: boolean;
  proposal_token?: string | null;
  rationale?: string | null;
  operations?: string[];
}

export interface AiResponse {
  reply: string;
  changes: AppliedChange[];
  pending: PendingAction[];
  board: Board;
}

export interface CardDraftResponse {
  drafts: CardDraft[];
  /** What the assistant said when it drafted nothing. */
  note: string;
}

export interface WorkspaceAiEvidence {
  kind: string;
  title: string;
  board_id: number;
  card_id: number | null;
}

export interface WorkspaceAiResponse {
  answer: string;
  next_actions: string[];
  evidence: WorkspaceAiEvidence[];
}
