"use client";

import Link from "next/link";
import { useState } from "react";
import { resetPassword } from "@/app/auth/actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch {
      setError("This reset link is invalid or has expired.");
    } finally {
      setPending(false);
    }
  }

  if (done) return <div><h1>Password updated</h1><p className="auth-switch"><Link href="/signin">Sign in</Link></p></div>;

  return (
    <form onSubmit={submit} noValidate>
      <h1>Choose a new password</h1>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <p className="auth-field"><label htmlFor="new-password">New password</label><input id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} maxLength={128} required autoComplete="new-password" /></p>
      <p className="auth-field"><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} maxLength={128} required autoComplete="new-password" /></p>
      <button className="auth-submit" type="submit" disabled={pending}>{pending ? "Updating…" : "Update password"}</button>
    </form>
  );
}
