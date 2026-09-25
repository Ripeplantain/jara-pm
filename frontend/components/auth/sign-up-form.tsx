"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { registerAction, type RegisterResult } from "@/app/signup/actions";

export function SignUpForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<NonNullable<RegisterResult["errors"]>>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    setPending(true);
    setErrors({});
    const result = await registerAction(email, password);
    if (!result.ok) {
      setErrors(result.errors ?? { form: "Could not create the account." });
      setPending(false);
      return;
    }
    // Sign-up succeeded: sign the new user in.
    const res = await signIn("credentials", { email, password, redirect: false });
    setPending(false);
    if (!res || res.error) {
      router.push("/signin");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <h1>Sign up</h1>
      <p className="auth-form-intro">Create a private workspace for the work that matters.</p>
      {errors.form && <p className="auth-error" role="alert">{errors.form}</p>}
      <p className="auth-field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "email-error" : undefined}
        />
        {errors.email && (
          <span id="email-error" className="field-error" role="alert">{errors.email}</span>
        )}
      </p>
      <p className="auth-field">
        <label htmlFor="password">Password (at least 8 characters)</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? "password-error" : undefined}
        />
        {errors.password && (
          <span id="password-error" className="field-error" role="alert">{errors.password}</span>
        )}
      </p>
      <button className="auth-submit" type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </button>
      <p className="auth-switch">
        Already registered? <Link href="/signin">Sign in</Link>
      </p>
    </form>
  );
}
