/** Mirror backend/app/schemas/card_details.py. */
import type { User } from "@/lib/types/auth";

export interface ChecklistItem {
  id: number;
  card_id: number;
  text: string;
  done: boolean;
  position: number;
}

export interface Comment {
  id: number;
  card_id: number;
  author_id: number | null;
  author: User | null;
  body: string;
  created_at: string;
  updated_at: string;
  edited: boolean;
}
