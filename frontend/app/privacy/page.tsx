import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy · Kobi" };

export default function PrivacyPage() {
  return (
    <main className="public-page">
      <div className="public-page-inner">
        <Link className="brand-link" href="/signin"><span className="brand-mark" aria-hidden="true">K</span> Kobi</Link>
        <h1>Privacy</h1>
        <p>We use the information needed to provide Kobi: your account email, profile, workspace content and product usage required to operate the service.</p>
        <h2>How we use data</h2>
        <p>Workspace data is used to provide collaboration, search, notifications, analytics and the AI features you request. Resend receives transactional email recipients and message content only when Kobi sends account or invitation email.</p>
        <h2>Your controls</h2>
        <p>Members can export workspace data. Owners can delete workspaces. Account deletion removes the account and eligible personal workspace data; shared workspace ownership must be transferred first.</p>
        <p className="muted">This MVP policy is a plain-language summary and should be reviewed with counsel before a public launch.</p>
        <Link href="/terms">Read terms</Link>
      </div>
    </main>
  );
}
