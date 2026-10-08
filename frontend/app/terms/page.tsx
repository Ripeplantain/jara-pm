import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms · Kobi" };

export default function TermsPage() {
  return (
    <main className="public-page">
      <div className="public-page-inner">
        <Link className="brand-link" href="/signin"><span className="brand-mark" aria-hidden="true">K</span> Kobi</Link>
        <h1>Terms</h1>
        <p>Kobi is a collaborative product-management workspace. You are responsible for the content you add, the people you invite and keeping your credentials secure.</p>
        <h2>Acceptable use</h2>
        <p>Do not use Kobi to abuse, impersonate, attack or attempt to access another workspace. AI suggestions are assistive and should be reviewed before important decisions or changes.</p>
        <h2>Service and data</h2>
        <p>We work to keep the service available and protect your data, but the invite-only beta may include changes, limits or interruptions. Export important workspace data and maintain your own operational backups.</p>
        <p className="muted">This MVP terms summary should be reviewed with counsel before a public launch.</p>
        <Link href="/privacy">Read privacy summary</Link>
      </div>
    </main>
  );
}
