/** Mirror backend/app/schemas/analytics.py. */
import type { Activity } from "@/lib/types/activity";

export interface ColumnStat {
  column_id: number;
  title: string;
  count: number;
  wip_limit: number | null;
  over_wip_limit: boolean;
  is_done: boolean;
}

export interface WeekStat {
  week_starting: string;
  completed: number;
}

export interface WorkloadStat {
  user_id: number | null; // null is the unassigned bucket
  name: string;
  avatar_color: string;
  open_cards: number;
  estimate: number;
}

export interface BoardAnalytics {
  board_id: number;
  total_cards: number;
  open_cards: number;
  completed_cards: number;
  columns: ColumnStat[];
  throughput: WeekStat[];
  /** null until something has been completed; `cycle_time_sample` says how many cards it is from. */
  cycle_time_hours: number | null;
  cycle_time_sample: number;
  workload: WorkloadStat[];
  overdue: number;
  due_soon: number;
  unestimated: number;
}

export interface BoardStat {
  board_id: number;
  title: string;
  is_favorite: boolean;
  total_cards: number;
  open_cards: number;
  overdue: number;
}

export interface WorkspaceSignal {
  kind: string;
  severity: "info" | "warning" | "danger";
  title: string;
  detail: string;
  board_id: number;
  card_id: number | null;
}

export interface SprintHealth {
  board_id: number;
  board_title: string;
  sprint_id: number;
  name: string;
  total: number;
  done: number;
  estimate_total: number;
  estimate_done: number;
  ends_on: string | null;
}

export interface WorkspaceOverview {
  workspace_id: number;
  boards: BoardStat[];
  my_open_cards: number;
  my_overdue: number;
  my_due_soon: number;
  recent_activity: Activity[];
  signals: WorkspaceSignal[];
  active_sprints: SprintHealth[];
}
