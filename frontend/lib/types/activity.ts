/** Mirror backend/app/schemas/activity.py and notifications.py. */
import type { User } from "@/lib/types/auth";

export interface Activity {
  id: number;
  workspace_id: number;
  board_id: number | null;
  card_id: number | null;
  actor_id: number | null;
  actor: User | null;
  /** The subject when it is neither a board nor a card: "note" or "goal". */
  entity_type: string | null;
  entity_id: number | null;
  action: string;
  summary: string;
  created_at: string;
}

export interface Notification {
  id: number;
  workspace_id: number;
  kind: string;
  title: string;
  body: string;
  board_id: number | null;
  card_id: number | null;
  actor_id: number | null;
  read_at: string | null;
  created_at: string;
}
