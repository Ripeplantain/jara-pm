"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  label: string; // e.g. "Add card"
  placeholder: string;
  maxLength: number;
  onSubmit: (title: string) => Promise<void> | void;
}

/** Button that expands into a one-line form. Enter submits, Escape cancels. */
export function AddForm({ label, placeholder, maxLength, onSubmit }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    setTitle("");
    requestAnimationFrame(() => buttonRef.current?.focus());
  }

  if (!open) {
    return (
      <button ref={buttonRef} type="button" className="add-button" onClick={() => setOpen(true)}>
        + {label}
      </button>
    );
  }

  return (
    <form
      className="add-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const t = title.trim();
        if (!t || busy) return;
        setBusy(true);
        try {
          await onSubmit(t);
          setTitle("");
          inputRef.current?.focus(); // stay open to add several in a row
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        ref={inputRef}
        value={title}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
      />
      <button type="submit" disabled={busy || !title.trim()}>
        {label}
      </button>
      <button type="button" onClick={close}>
        Cancel
      </button>
    </form>
  );
}
