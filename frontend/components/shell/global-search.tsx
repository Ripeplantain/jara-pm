"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/browser";
import type { CardHit } from "@/lib/types/board";

export function GlobalSearch({ workspaceId }: { workspaceId: number }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setError(null);
    try {
      setResults(await api.search(workspaceId, query.trim()));
    } catch {
      setResults([]);
      setError("Search is unavailable. Try again.");
    }
  }

  return (
    <>
      <button type="button" className="sidebar-search-trigger" onClick={() => setOpen(true)}>
        <span aria-hidden="true">⌕</span><span>Search workspace</span><kbd>⌘K</kbd>
      </button>
      {open && (
        <div className="command-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section className="command-panel" role="dialog" aria-modal="true" aria-label="Search workspace" onMouseDown={(e) => e.stopPropagation()}>
            <form onSubmit={search}>
              <label htmlFor="global-search">Search cards</label>
              <input id="global-search" ref={input} value={query} placeholder="Try a title or keyword…" onChange={(e) => setQuery(e.target.value)} />
            </form>
            <ul className="command-results">
              {results.map((card) => (
                <li key={card.id}>
                  <Link href={`/boards/${card.board_id}?card=${card.id}`} onClick={() => setOpen(false)}>
                    <strong>{card.title}</strong><span>{card.board_title} · {card.column_title}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {error && <p className="search-error" role="alert">{error}</p>}
            {!error && query && results.length === 0 && <p className="muted">No matching cards.</p>}
            <p className="command-hint">Press Esc to close</p>
          </section>
        </div>
      )}
    </>
  );
}
