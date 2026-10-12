import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { KobiLogo } from "@/components/shell/kobi-logo";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  return (
    <main className="auth-page">
      <div className="auth-shell">
        <section className="auth-pitch" aria-label="Kobi">
          <a className="brand-link" href="/signup">
            <KobiLogo size="md" />
          </a>
          <h1>Build your next clear move.</h1>
          <p>Organize the details, keep the priorities visible, and let your board do the talking.</p>
        </section>
        <section className="auth-form-wrap">
          <SignUpForm inviteToken={invite} />
        </section>
      </div>
    </main>
  );
}
