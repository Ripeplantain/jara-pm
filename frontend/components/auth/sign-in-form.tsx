"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState } from "react";

/** Only allow same-site relative paths as post-login targets. */
function safeCallback(url: string | null): string {
  return url && url.startsWith("/") && !url.startsWith("//") ? url : "/";
}

export function SignInForm({ callbackUrl }: { callbackUrl: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const res = await signIn("credentials", {
      email: form.get("email"),
      password: form.get("password"),
      redirect: false,
    });
    setPending(false);
    if (!res || res.error) {
      // Generic on purpose: don't reveal whether the email exists.
      setError("Invalid email or password.");
      return;
    }
    router.push(safeCallback(callbackUrl));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <h1>Sign in</h1>
      <p className="auth-form-intro">Welcome back. Pick up where you left off.</p>
      {error && (
        <p id="signin-error" className="auth-error" role="alert">
          {error}
        </p>
      )}
      <p className="auth-field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "signin-error" : undefined}
        />
      </p>
      <p className="auth-field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "signin-error" : undefined}
        />
      </p>
      <button className="auth-submit" type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="auth-switch">
        No account? <Link href="/signup">Sign up</Link>
      </p>
    </form>
  );
}
