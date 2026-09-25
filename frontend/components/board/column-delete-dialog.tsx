"use client";

import { useState } from "react";
import { Modal } from "@/components/board/modal";
import type { Column } from "@/lib/types/board";

export type DeleteChoice = { moveCardsTo?: number; deleteCards?: boolean };

interface Props {
  column: Column;
  others: Column[];
  onConfirm: (choice: DeleteChoice) => void;
  onCancel: () => void;
}

export function ColumnDeleteDialog({ column, others, onConfirm, onCancel }: Props) {
  const hasCards = column.cards.length > 0;
  const [mode, setMode] = useState<"move" | "delete">(others.length ? "move" : "delete");
  const [target, setTarget] = useState(others[0]?.id);

  return (
    <Modal label={`Delete column ${column.title}`} onClose={onCancel}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!hasCards) onConfirm({});
          else if (mode === "move" && target !== undefined) onConfirm({ moveCardsTo: target });
          else onConfirm({ deleteCards: true });
        }}
      >
        <h2>Delete column “{column.title}”?</h2>
        {hasCards ? (
          <fieldset>
            <legend>
              This column has {column.cards.length} {column.cards.length === 1 ? "card" : "cards"}.
            </legend>
            <label>
              <input
                type="radio"
                name="mode"
                checked={mode === "move"}
                disabled={!others.length}
                onChange={() => setMode("move")}
              />{" "}
              Move the cards to
            </label>{" "}
            <select
              aria-label="Column to move cards to"
              value={target}
              disabled={mode !== "move" || !others.length}
              onChange={(e) => setTarget(Number(e.target.value))}
            >
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <br />
            <label>
              <input
                type="radio"
                name="mode"
                checked={mode === "delete"}
                onChange={() => setMode("delete")}
              />{" "}
              Delete the cards too
            </label>
          </fieldset>
        ) : (
          <p>This column is empty.</p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="danger">
            Delete column
          </button>
        </div>
      </form>
    </Modal>
  );
}
