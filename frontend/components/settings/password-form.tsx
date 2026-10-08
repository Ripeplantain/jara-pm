"use client";

import { useState } from "react";
import { api, RequestError } from "@/lib/api/browser";

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    if (next.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Could not change your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings-card" onSubmit={submit}>
      <h2>Password</h2>
      <p className="muted">
        Changing it does not sign out your other sessions; they expire on their own within the
        hour.
      </p>

      <div className="field">
        <label htmlFor="current-password">Current password</label>
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          required
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="new-password">New password</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={next}
          required
          onChange={(e) => setNext(e.target.value)}
        />
        <p className="field-hint">At least 8 characters.</p>
      </div>
      <div className="field">
        <label htmlFor="confirm-password">Confirm new password</label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          required
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="notice success">
          Password changed.
        </p>
      )}

      <button type="submit" disabled={busy}>
        {busy ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}
