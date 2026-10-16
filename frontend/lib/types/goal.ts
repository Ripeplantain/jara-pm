/** Mirror backend/app/schemas/goals.py. */

export type GoalState = "active" | "achieved" | "archived";

/** Mirrors GOAL_LINK_TYPES in backend/app/models/goal.py. */
export type GoalLinkType = "board" | "sprint" | "card";

export interface GoalLink {
  id: number;
  milestone_id: number | null;
  target_type: GoalLinkType;
  target_id: number;
  /** Resolved when the goal is read; empty when the work has since been deleted. */
  target_title: string;
  /** Where to go to see the work: a card's board, or the board itself. */
  board_id: number | null;
}

export interface GoalMilestone {
  id: number;
  goal_id: number;
  title: string;
  target_date: string | null;
  position: number;
  cards_total: number;
  cards_done: number;
  unresolved_links: number;
  percent: number;
  links: GoalLink[];
}

export interface Goal {
  id: number;
  workspace_id: number;
  title: string;
  detail: string;
  state: GoalState;
  starts_on: string | null;
  target_date: string | null;
  created_at: string;
  updated_at: string;
  achieved_at: string | null;

  /** The mean of the goal's groups: one per milestone, plus one for its own direct links. */
  percent: number;
  cards_total: number;
  cards_done: number;
  unresolved_links: number;
  /** False while nothing is linked: unmeasured, which is not the same as 0%. */
  has_evidence: boolean;
  milestones: GoalMilestone[];
  /** The goal's own links, the ones not attached to a milestone. */
  links: GoalLink[];
}

/** A goal found by workspace search; deliberately without its progress. */
export interface GoalHit {
  id: number;
  workspace_id: number;
  title: string;
  state: GoalState;
  target_date: string | null;
}

export interface GoalPatch {
  title?: string;
  detail?: string;
  /** Sent as null the date is cleared; left out it is kept. */
  starts_on?: string | null;
  target_date?: string | null;
  state?: GoalState;
}

/** Where a link points, for the row that shows it. */
export function linkHref(link: GoalLink): string | null {
  if (link.target_type === "card") {
    return link.board_id ? `/boards/${link.board_id}?card=${link.target_id}` : null;
  }
  return link.board_id ? `/boards/${link.board_id}` : null;
}

export function linkLabel(link: GoalLink): string {
  return link.target_title || "No longer available";
}

export const STATE_LABELS: Record<GoalState, string> = {
  active: "Active",
  achieved: "Achieved",
  archived: "Archived",
};
