"use client";

import Link from "next/link";
import { useState } from "react";
import { requestPasswordReset } from "@/app/auth/actions";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    await requestPasswordReset(email).catch(() => undefined);
    setSent(true);
    setPending(false);
  }

  return sent ? (
    <div>
      <h1>Check your email</h1>
      <p className="auth-form-intro">If an account exists for that address, a reset link is on its way.</p>
      <p className="auth-switch"><Link href="/signin">Back to sign in</Link></p>
    </div>
  ) : (
    <form onSubmit={submit} noValidate>
      <h1>Reset your password</h1>
      <p className="auth-form-intro">We’ll send a secure, single-use reset link.</p>
      <p className="auth-field">
        <label htmlFor="reset-email">Email</label>
        <input id="reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </p>
      <button className="auth-submit" type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </button>
      <p className="auth-switch"><Link href="/signin">Back to sign in</Link></p>
    </form>
  );
}
