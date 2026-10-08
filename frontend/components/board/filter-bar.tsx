"use client";

import type { Priority } from "@/lib/types/board";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/types/board";
import type { Label } from "@/lib/types/label";
import type { Member } from "@/lib/types/workspace";

export interface Filters {
  q: string;
  assigneeId: number | null;
  labelId: number | null;
  priority: Priority | null;
  due: "any" | "overdue" | "week";
  onlyMine: boolean;
}

export const EMPTY_FILTERS: Filters = {
  q: "",
  assigneeId: null,
  labelId: null,
  priority: null,
  due: "any",
  onlyMine: false,
};

export function activeFilterCount(filters: Filters): number {
  return (
    (filters.q.trim() ? 1 : 0) +
    (filters.assigneeId !== null ? 1 : 0) +
    (filters.labelId !== null ? 1 : 0) +
    (filters.priority !== null ? 1 : 0) +
    (filters.due !== "any" ? 1 : 0) +
    (filters.onlyMine ? 1 : 0)
  );
}

/**
 * Narrows what the board shows. Filtering happens in the browser against the board already in
 * memory: a board is a few hundred cards at most, and a filter that responds on the keystroke
 * is worth more here than one that is authoritative to the millisecond.
 */
export function FilterBar({
  filters,
  members,
  labels,
  onChange,
}: {
  filters: Filters;
  members: Member[];
  labels: Label[];
  onChange: (next: Filters) => void;
}) {
  const count = activeFilterCount(filters);
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  return (
    <div className="filter-bar" role="search">
      <label className="filter-search">
        <span className="sr-only">Search cards on this board</span>
        <input
          type="search"
          value={filters.q}
          placeholder="Search cards"
          onChange={(e) => set({ q: e.target.value })}
        />
      </label>

      <label>
        <span className="sr-only">Filter by assignee</span>
        <select
          value={filters.assigneeId ?? ""}
          onChange={(e) =>
            set({ assigneeId: e.target.value ? Number(e.target.value) : null, onlyMine: false })
          }
        >
          <option value="">Anyone</option>
          {members.map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.user.name}
            </option>
          ))}
        </select>
      </label>

      {labels.length > 0 && (
        <label>
          <span className="sr-only">Filter by label</span>
          <select
            value={filters.labelId ?? ""}
            onChange={(e) => set({ labelId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Any label</option>
            {labels.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label>
        <span className="sr-only">Filter by priority</span>
        <select
          value={filters.priority ?? ""}
          onChange={(e) => set({ priority: (e.target.value || null) as Priority | null })}
        >
          <option value="">Any priority</option>
          {PRIORITIES.filter((p) => p !== "none").map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="sr-only">Filter by due date</span>
        <select
          value={filters.due}
          onChange={(e) => set({ due: e.target.value as Filters["due"] })}
        >
          <option value="any">Any date</option>
          <option value="overdue">Overdue</option>
          <option value="week">Due this week</option>
        </select>
      </label>

      <label className="toggle">
        <input
          type="checkbox"
          checked={filters.onlyMine}
          onChange={(e) => set({ onlyMine: e.target.checked, assigneeId: null })}
        />
        Only mine
      </label>

      {count > 0 && (
        <button type="button" onClick={() => onChange(EMPTY_FILTERS)}>
          Clear {count} {count === 1 ? "filter" : "filters"}
        </button>
      )}
    </div>
  );
}
