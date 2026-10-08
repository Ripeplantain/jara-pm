/** Date helpers shared by the card face, the drawer and "my work". */

export type DueState = "none" | "overdue" | "today" | "soon" | "later" | "done";

const DAY = 24 * 60 * 60 * 1000;

export function dueState(iso: string | null, completed: string | null, now = Date.now()): DueState {
  if (completed) return "done";
  if (!iso) return "none";
  const due = new Date(iso).getTime();
  if (due < now) return "overdue";
  if (due - now < DAY) return "today";
  if (due - now < 7 * DAY) return "soon";
  return "later";
}

/** "12 Mar", or "12 Mar 2027" when it is not this year. */
export function shortDate(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** For <input type="date">, which only understands YYYY-MM-DD in local time. */
export function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/** Back the other way: an empty box clears the date. */
export function fromDateInput(value: string): string | null {
  if (!value) return null;
  // End of that day locally, so "due today" stays due until the day is over.
  const date = new Date(`${value}T23:59:59`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function longDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const AGO = [
  [60, "s"],
  [60, "m"],
  [24, "h"],
  [365, "d"],
] as const;

/** Compact relative time that is safe to share between server and client components. */
export function shortAgo(iso: string, from = Date.now()): string {
  let value = Math.max(0, (from - new Date(iso).getTime()) / 1000);
  let unit = "s";
  for (const [size, next] of AGO) {
    if (value < size) break;
    value /= size;
    unit = next;
  }
  return `${Math.floor(value)}${unit}`;
}
