import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = { title: "Sign up" };

export default function SignUpPage() {
  return (
    <main className="auth-page">
      <div className="auth-shell">
        <section className="auth-pitch" aria-label="Kobi">
          <a className="brand-link" href="/signup">
            <span className="brand-mark" aria-hidden="true">K</span>
            <span>Kobi</span>
          </a>
          <h1>Build your next clear move.</h1>
          <p>Organize the details, keep the priorities visible, and let your board do the talking.</p>
        </section>
        <section className="auth-form-wrap">
          <SignUpForm />
        </section>
      </div>
    </main>
  );
}
