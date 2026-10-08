/** Mirror backend/app/schemas/sprints.py. */
export type SprintState = "planned" | "active" | "completed";

export interface Sprint {
  id: number;
  board_id: number;
  name: string;
  goal: string;
  starts_on: string | null;
  ends_on: string | null;
  state: SprintState;
  created_at: string;
  completed_at: string | null;
}

export interface SprintProgress {
  total: number;
  done: number;
  estimate_total: number;
  estimate_done: number;
}
