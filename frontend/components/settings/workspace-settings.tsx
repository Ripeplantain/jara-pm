"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/board/modal";
import { api, RequestError } from "@/lib/api/browser";
import type { Label, LabelColor } from "@/lib/types/label";
import { LABEL_COLORS } from "@/lib/types/label";
import type { Workspace } from "@/lib/types/workspace";
import { atLeast, canAdminister, canWrite } from "@/lib/types/workspace";

const message = (err: unknown) =>
  err instanceof RequestError ? err.message : "Something went wrong. Please try again.";

export function WorkspaceSettings({
  workspace,
  labels: initialLabels,
  workspaceCount,
}: {
  workspace: Workspace;
  labels: Label[];
  workspaceCount: number;
}) {
  const router = useRouter();
  const [name, setName] = useState(workspace.name);
  const [labels, setLabels] = useState(initialLabels);
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState<LabelColor>("indigo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const mayAdmin = canAdminister(workspace.my_role);
  const mayCreateLabels = canWrite(workspace.my_role);
  const mayDelete = atLeast(workspace.my_role, "owner") && workspaceCount > 1;

  async function exportData() {
    setExporting(true);
    setError(null);
    try {
      const data = await api.exportWorkspace(workspace.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${workspace.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-export.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(message(err));
    } finally {
      setExporting(false);
    }
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await fn();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form
        className="settings-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          run(async () => {
            await api.renameWorkspace(workspace.id, name.trim());
            setSaved(true);
            router.refresh();
          });
        }}
      >
        <h2>Workspace</h2>
        <div className="field">
          <label htmlFor="workspace-name">Name</label>
          <input
            id="workspace-name"
            value={name}
            maxLength={200}
            required
            disabled={!mayAdmin}
            onChange={(e) => setName(e.target.value)}
          />
          {!mayAdmin && <p className="field-hint">Only admins and owners can rename a workspace.</p>}
        </div>
        {saved && (
          <p role="status" className="notice success">
            Saved.
          </p>
        )}
        {mayAdmin && (
          <button type="submit" disabled={busy || !name.trim()}>
            Save
          </button>
        )}
      </form>

      <section className="settings-card">
        <h2>Labels</h2>
        <p className="muted">
          Labels are shared by every board in this workspace. Members can add them; renaming or
          deleting one changes every board at once, so that needs an admin.
        </p>

        {mayCreateLabels && (
          <form
            className="label-form"
            onSubmit={(e) => {
              e.preventDefault();
              const text = newLabel.trim();
              if (!text) return;
              run(async () => {
                const created = await api.createLabel(workspace.id, text, newColor);
                setLabels((list) => [...list, created].sort((a, b) => a.name.localeCompare(b.name)));
                setNewLabel("");
              });
            }}
          >
            <div className="field">
              <label htmlFor="new-label">New label</label>
              <input
                id="new-label"
                value={newLabel}
                maxLength={50}
                placeholder="e.g. needs design"
                onChange={(e) => setNewLabel(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="label-color">Colour</label>
              <select
                id="label-color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value as LabelColor)}
              >
                {LABEL_COLORS.map((color) => (
                  <option key={color} value={color}>
                    {color}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" disabled={busy || !newLabel.trim()}>
              Add label
            </button>
          </form>
        )}

        {labels.length === 0 ? (
          <p className="empty-state">No labels yet.</p>
        ) : (
          <ul className="label-manage-list">
            {labels.map((label) => (
              <li key={label.id}>
                <span className={`label-chip tint-${label.color}`}>{label.name}</span>
                {mayAdmin && (
                  <>
                    <select
                      aria-label={`Colour for ${label.name}`}
                      value={label.color}
                      disabled={busy}
                      onChange={(e) =>
                        run(async () => {
                          const updated = await api.updateLabel(label.id, {
                            color: e.target.value,
                          });
                          setLabels((list) =>
                            list.map((l) => (l.id === label.id ? updated : l)),
                          );
                        })
                      }
                    >
                      {LABEL_COLORS.map((color) => (
                        <option key={color} value={color}>
                          {color}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api.deleteLabel(label.id);
                          setLabels((list) => list.filter((l) => l.id !== label.id));
                        })
                      }
                    >
                      Delete
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}

      {atLeast(workspace.my_role, "owner") && (
        <section className="settings-card danger-zone">
          <h2>Danger zone</h2>
          <p>Download a copy of this workspace before making destructive changes.</p>
          <button type="button" disabled={exporting} onClick={() => void exportData()}>
            {exporting ? "Preparing export…" : "Export workspace data"}
          </button>
          <p>
            Deleting this workspace removes every board, card and label in it, for everyone. It
            cannot be undone.
          </p>
          {workspaceCount <= 1 && (
            <p className="field-hint">
              This is your only workspace, so it cannot be deleted. Create another one first.
            </p>
          )}
          <button
            type="button"
            className="danger"
            disabled={!mayDelete || busy}
            onClick={() => setDeleting(true)}
          >
            Delete workspace
          </button>
        </section>
      )}

      {deleting && (
        <Modal label="Delete workspace" onClose={() => setDeleting(false)}>
          <h2>Delete “{workspace.name}”?</h2>
          <p>
            Every board, card, label and comment in this workspace is removed for all{" "}
            {workspace.members.length} members. This cannot be undone.
          </p>
          <div className="row-actions">
            <button
              type="button"
              className="danger"
              onClick={() => {
                setDeleting(false);
                run(async () => {
                  await api.deleteWorkspace(workspace.id, "DELETE");
                  router.push("/");
                  router.refresh();
                });
              }}
            >
              Delete everything
            </button>
            <button type="button" onClick={() => setDeleting(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
