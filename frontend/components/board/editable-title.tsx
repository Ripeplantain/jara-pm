"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  /** Accessible name, e.g. "Column title". */
  label: string;
  maxLength: number;
  onCommit: (title: string) => void;
  className?: string;
}

/** Inline title editing: commit on Enter or blur, cancel on Escape, empty titles rejected. */
export function EditableTitle({ value, label, maxLength, onCommit, className }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlur = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function start() {
    skipBlur.current = false;
    setDraft(value);
    setError(null);
    setEditing(true);
  }

  function commit() {
    const title = draft.trim();
    if (!title) {
      setError("Title can't be empty.");
      return;
    }
    setEditing(false);
    if (title !== value) onCommit(title);
  }

  function cancel() {
    skipBlur.current = true;
    setEditing(false);
    setError(null);
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={`title-button ${className ?? ""}`}
        aria-label={`${label}: ${value}. Rename`}
        onClick={start}
      >
        {value}
      </button>
    );
  }

  return (
    <span className="title-edit">
      <input
        ref={inputRef}
        value={draft}
        maxLength={maxLength}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            cancel();
          }
        }}
        onBlur={() => {
          if (skipBlur.current) {
            skipBlur.current = false;
            return;
          }
          // Blurring with an empty title abandons the edit instead of trapping focus.
          if (!draft.trim()) cancel();
          else commit();
        }}
      />
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
