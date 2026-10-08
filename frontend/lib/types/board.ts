/** Mirror backend schemas in backend/app/schemas/boards.py. */
import type { User } from "@/lib/types/auth";
import type { ChecklistItem } from "@/lib/types/card-detail";
import type { Label } from "@/lib/types/label";

export const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABEL: Record<Priority, string> = {
  none: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export interface Card {
  id: number;
  column_id: number;
  title: string;
  description: string;
  position: number;
  assignee_id: number | null;
  assignee: User | null;
  created_by_id: number | null;
  priority: Priority;
  sprint_id: number | null;
  due_date: string | null;
  estimate: number | null;
  created_at: string;
  updated_at: string;
  /** Set by moving into a column flagged `is_done`; never written directly. */
  completed_at: string | null;
  archived_at: string | null;
  labels: Label[];
  checklist: ChecklistItem[];
  checklist_done: number;
  checklist_total: number;
  comment_count: number;
}

/** A card found by search, shown outside its own board. */
export interface CardHit extends Card {
  board_id: number;
  board_title: string;
  column_title: string;
}

export interface Column {
  id: number;
  board_id: number;
  title: string;
  position: number;
  wip_limit: number | null;
  is_done: boolean;
  card_count: number;
  over_wip_limit: boolean;
  cards: Card[];
}

export interface BoardSummary {
  id: number;
  workspace_id: number;
  created_by_id: number | null;
  title: string;
  description: string;
  created_at: string;
  is_favorite: boolean;
}

export interface Board extends BoardSummary {
  columns: Column[];
}

export interface BoardTemplate {
  key: string;
  name: string;
  description: string;
  columns: string[];
}
