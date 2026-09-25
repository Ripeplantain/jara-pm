import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  return (
    <main className="auth-page">
      <div className="auth-shell">
        <section className="auth-pitch" aria-label="Kobi">
          <a className="brand-link" href="/signin">
            <span className="brand-mark" aria-hidden="true">K</span>
            <span>Kobi</span>
          </a>
          <h1>Make the work feel lighter.</h1>
          <p>A clear, calm space for turning ideas into momentum — with a little help from AI.</p>
        </section>
        <section className="auth-form-wrap">
          <SignInForm callbackUrl={callbackUrl ?? null} />
        </section>
      </div>
    </main>
  );
}
