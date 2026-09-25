"use client";

import { useState } from "react";
import { Modal } from "@/components/board/modal";
import type { Card } from "@/lib/types/board";

interface Props {
  card: Card;
  onSave: (patch: { title?: string; description?: string }) => void;
  onDelete: () => void;
  onCancel: () => void;
}

export function CardEditDialog({ card, onSave, onDelete, onCancel }: Props) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal label="Edit card" onClose={onCancel}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          const t = title.trim();
          if (!t) return setError("Title can't be empty.");
          const patch: { title?: string; description?: string } = {};
          if (t !== card.title) patch.title = t;
          if (description !== card.description) patch.description = description;
          if (Object.keys(patch).length) onSave(patch);
          else onCancel();
        }}
      >
        <h2>Edit card</h2>
        <p>
          <label>
            Title
            <br />
            <input
              value={title}
              maxLength={300}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          {error && <span role="alert"> {error}</span>}
        </p>
        <p>
          <label>
            Description
            <br />
            <textarea
              rows={5}
              maxLength={10000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </p>
        <div className="dialog-actions">
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (window.confirm(`Delete card “${card.title}”?`)) onDelete();
            }}
          >
            Delete card
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit">Save</button>
        </div>
      </form>
    </Modal>
  );
}
