"use client";

import { useEffect, useRef, useState } from "react";
import type { BoardActions } from "@/components/board/actions";
import type { Column } from "@/lib/types/board";

/** The per-column menu: WIP limit, the done flag, and deletion. */
export function ColumnSettings({ column, actions }: { column: Column; actions: BoardActions }) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(column.wip_limit?.toString() ?? "");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="column-settings" ref={root}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Settings for column ${column.title}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div className="column-menu" role="menu">
          <div className="field">
            <label htmlFor={`wip-${column.id}`}>Work-in-progress limit</label>
            <input
              id={`wip-${column.id}`}
              type="number"
              min={1}
              max={999}
              value={limit}
              placeholder="No limit"
              onChange={(e) => setLimit(e.target.value)}
              onBlur={() => {
                const next = limit === "" ? null : Number(limit);
                if (next !== column.wip_limit) actions.updateColumnSettings(column.id, { wip_limit: next });
              }}
            />
            <p className="field-hint">Going over is a warning, never a block.</p>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={column.is_done}
              onChange={(e) => actions.updateColumnSettings(column.id, { is_done: e.target.checked })}
            />
            Cards here are done
          </label>
          <button
            type="button"
            className="danger"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              actions.requestDeleteColumn(column);
            }}
          >
            Delete column
          </button>
        </div>
      )}
    </div>
  );
}
