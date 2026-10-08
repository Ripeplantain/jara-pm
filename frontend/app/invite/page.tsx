import Link from "next/link";
import type { Metadata } from "next";
import { backendFetch } from "@/lib/api/client";

export const metadata: Metadata = { title: "Workspace invitation · Kobi" };

interface InvitePreview {
  email: string;
  workspace_name: string;
  role: string;
  expires_at: string;
}

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const invite = token
    ? await backendFetch<InvitePreview>(
        "/api/auth/invites/" + encodeURIComponent(token),
      ).catch(() => null)
    : null;

  return (
    <main className="auth-page">
      <div className="auth-shell">
        <section className="auth-pitch" aria-label="Kobi">
          <a className="brand-link" href="/signin">
            <span className="brand-mark" aria-hidden="true">K</span>
            <span>Kobi</span>
          </a>
          <h1>Join the work.</h1>
          <p>One clear place for your team to turn product ideas into momentum.</p>
        </section>
        <section className="auth-form-wrap">
          {invite ? (
            <>
              <h1>You&apos;re invited</h1>
              <p>
                Join <strong>{invite.workspace_name}</strong> as a {invite.role} using{" "}
                <strong>{invite.email}</strong>.
              </p>
              <Link
                className="auth-submit"
                href={"/signup?invite=" + encodeURIComponent(token ?? "")}
              >
                Create your account
              </Link>
              <p className="auth-switch">
                Already have an account? <Link href="/signin">Sign in</Link>
              </p>
            </>
          ) : (
            <>
              <h1>Invitation unavailable</h1>
              <p role="alert">This invitation is invalid, expired, or has already been used.</p>
              <p className="auth-switch"><Link href="/signup">Create an account</Link></p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
