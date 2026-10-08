"use client";

import Link from "next/link";
import { useState } from "react";
import { resendVerification, verifyEmail } from "@/app/auth/actions";

export function VerifyEmailForm({ token }: { token: string | null }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function verify() {
    if (!token) return;
    setPending(true);
    setError(null);
    try {
      await verifyEmail(token);
      setMessage("Your email is verified. You can sign in now.");
    } catch {
      setError("This verification link is invalid or has expired.");
    } finally {
      setPending(false);
    }
  }

  async function resend(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await resendVerification(email);
      setMessage("If an unverified account exists, a new link is on its way.");
      setEmail("");
    } catch {
      setError("We could not send a new link. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <h1>Verify your email</h1>
      {message && <p className="auth-success" role="status">{message}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {token ? (
        <button className="auth-submit" type="button" onClick={verify} disabled={pending}>
          {pending ? "Verifying…" : "Verify email"}
        </button>
      ) : (
        <>
          <p className="auth-form-intro">Enter your email and we’ll send you a fresh link.</p>
          <form onSubmit={resend} noValidate>
            <p className="auth-field">
              <label htmlFor="verification-email">Email</label>
              <input id="verification-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </p>
            <button className="auth-submit" type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send verification link"}
            </button>
          </form>
        </>
      )}
      <p className="auth-switch"><Link href="/signin">Back to sign in</Link></p>
    </div>
  );
}
