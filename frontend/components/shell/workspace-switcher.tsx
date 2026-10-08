"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, RequestError } from "@/lib/api/browser";
import type { Workspace } from "@/lib/types/workspace";

/** Switches the active workspace and remembers it, or creates a new one. */
export function WorkspaceSwitcher({
  workspaces,
  active,
}: {
  workspaces: Workspace[];
  active: Workspace;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  async function choose(id: number) {
    setOpen(false);
    if (id === active.id) return;
    await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: id }),
    });
    router.push("/");
    router.refresh();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createWorkspace(trimmed);
      setName("");
      setCreating(false);
      await choose(created.id);
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Could not create that workspace.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="switcher" ref={root}>
      <button
        type="button"
        className="switcher-button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="switcher-name">{active.name}</span>
        <span className={`role-chip role-${active.my_role}`}>{active.my_role}</span>
        <span aria-hidden="true" className="chevron">
          ▾
        </span>
      </button>

      {open && (
        <div className="switcher-menu" role="menu" aria-label="Switch workspace">
          <p className="menu-label">Workspaces</p>
          <ul>
            {workspaces.map((workspace) => (
              <li key={workspace.id}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={workspace.id === active.id}
                  onClick={() => choose(workspace.id)}
                >
                  <span>{workspace.name}</span>
                  {workspace.id === active.id && (
                    <span aria-hidden="true" className="tick">
                      ✓
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {creating ? (
            <form className="switcher-create" onSubmit={create}>
              <label htmlFor="new-workspace">New workspace name</label>
              <input
                id="new-workspace"
                value={name}
                maxLength={200}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Platform team"
              />
              <div className="row-actions">
                <button type="submit" disabled={busy || !name.trim()}>
                  {busy ? "Creating…" : "Create"}
                </button>
                <button type="button" onClick={() => setCreating(false)}>
                  Cancel
                </button>
              </div>
              {error && (
                <p role="alert" className="field-error">
                  {error}
                </p>
              )}
            </form>
          ) : (
            <button type="button" className="switcher-new" onClick={() => setCreating(true)}>
              + New workspace
            </button>
          )}
        </div>
      )}
    </div>
  );
}
