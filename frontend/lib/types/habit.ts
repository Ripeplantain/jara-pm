/** Mirror backend/app/schemas/habits.py. */

/** Mirrors HabitSchedule in backend/app/models/habit.py. */
export type HabitSchedule = "daily" | "weekly" | "times_per_week";

export const SCHEDULES: { value: HabitSchedule; label: string; hint: string }[] = [
  { value: "daily", label: "Every day", hint: "The streak counts days" },
  { value: "weekly", label: "Once a week", hint: "Any day of the week" },
  { value: "times_per_week", label: "A few times a week", hint: "You choose how many" },
];

export const MAX_TARGET_PER_WEEK = 7;

/** The same palette labels use; each name maps to a `tint-*` class in globals.css. */
export const HABIT_COLORS = [
  "slate",
  "indigo",
  "cyan",
  "emerald",
  "amber",
  "rose",
  "violet",
] as const;
export type HabitColor = (typeof HABIT_COLORS)[number];

export interface Habit {
  id: number;
  workspace_id: number;
  name: string;
  detail: string;
  schedule: HabitSchedule;
  target_per_week: number;
  color: string;
  created_at: string;
  archived_at: string | null;

  /** Everything below is derived by the backend from the check-in log, never stored. */
  done_today: boolean;
  due_today: boolean;
  current_streak: number;
  longest_streak: number;
  /** "day" or "week": what this habit's streak counts, given its schedule. */
  streak_unit: string;
  week_done: number;
  week_target: number;
  total_checkins: number;
  /** The ticked days inside the window the grid draws, oldest first, as ISO dates. */
  history: string[];
}

export interface HabitPatch {
  name?: string;
  detail?: string;
  schedule?: HabitSchedule;
  target_per_week?: number;
  color?: HabitColor;
}

/** How a habit's schedule reads in a sentence. */
export function scheduleLabel(habit: Habit): string {
  if (habit.schedule === "daily") return "Every day";
  if (habit.schedule === "weekly") return "Once a week";
  return `${habit.target_per_week}× a week`;
}

/** "5 days" / "1 week": the unit comes from the backend, which knows the schedule. */
export function streakLabel(habit: Habit): string {
  const unit = habit.current_streak === 1 ? habit.streak_unit : `${habit.streak_unit}s`;
  return `${habit.current_streak} ${unit}`;
}
