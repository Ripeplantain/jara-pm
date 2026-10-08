"use client";

import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";
import { api, RequestError } from "@/lib/api/browser";

export function AccountDangerZone() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function removeAccount() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(password);
      await signOut({ redirect: false });
      router.push("/signin");
      router.refresh();
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Could not delete your account.");
      setBusy(false);
    }
  }

  return (
    <section className="settings-card danger-zone">
      <h2>Delete account</h2>
      <p>
        This permanently removes your personal workspace and account. Shared workspaces require
        ownership transfer first.
      </p>
      {!confirming ? (
        <button type="button" className="danger" onClick={() => setConfirming(true)}>
          Delete my account
        </button>
      ) : (
        <div className="field">
          <label htmlFor="account-delete-password">Confirm with your password</label>
          <input
            id="account-delete-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="row-actions">
            <button type="button" className="danger" disabled={busy || !password} onClick={() => void removeAccount()}>
              {busy ? "Deleting…" : "Permanently delete"}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
