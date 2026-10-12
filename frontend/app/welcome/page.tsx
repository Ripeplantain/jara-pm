import type { Metadata } from "next";
import Link from "next/link";
import { KobiLogo } from "@/components/shell/kobi-logo";

export const metadata: Metadata = {
  title: "A calmer home for product work",
  description: "Kobi brings boards, decisions, planning and context into one calm workspace.",
};

export default function WelcomePage() {
  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Marketing navigation">
        <Link className="brand-link" href="/welcome">
          <KobiLogo size="md" />
        </Link>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link className="landing-nav-cta" href="/signup">Join the beta</Link>
        </div>
      </nav>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-copy">
          <p className="eyebrow">A calmer home for product work</p>
          <h1 id="landing-title">Your team’s work, in one clear place.</h1>
          <p className="landing-lede">
            Kobi brings boards, decisions, planning and the context behind them into a workspace
            that feels as natural as a good notebook.
          </p>
          <div className="landing-actions">
            <Link className="landing-primary" href="/signup">Join the invite-only beta <span aria-hidden="true">↗</span></Link>
            <Link className="landing-secondary" href="/signin">Sign in</Link>
          </div>
          <p className="landing-note">A quiet workspace for teams that want to do their best work.</p>
        </div>
        <div className="landing-preview" aria-label="Kobi workspace preview">
          <div className="preview-window-bar"><span /><span /><span /><b>Product workspace</b><small>kobi.app</small></div>
          <div className="preview-content">
            <div className="preview-sidebar"><KobiLogo size="sm" /><span className="preview-active">Overview</span><span>Boards</span><span>My work</span><span>Activity</span><span className="preview-sidebar-spacer" /><span className="preview-ask">✦ Ask Kobi</span></div>
            <div className="preview-board"><small>MONDAY, OCTOBER 11 · PRODUCT</small><h2>Make checkout feel effortless</h2><p className="preview-board-note">The team is focused on reducing friction from first click to first purchase.</p><div className="preview-columns"><div><b>To do <em>3</em></b><i>Clarify pricing copy</i><i>Map the happy path</i></div><div><b>In progress <em>1</em></b><i>Run user interviews</i></div><div><b>Done <em>2</em></b><i>Define activation metric</i></div></div></div>
          </div>
        </div>
      </section>

      <section className="landing-points" aria-label="Kobi capabilities">
        <article><span>01</span><h2>See the work</h2><p>Boards, sprints, ownership and signals that make the state of your product easy to read.</p></article>
        <article><span>02</span><h2>Keep the context</h2><p>Notes, decisions and delivery live together, so no one has to reconstruct the story.</p></article>
        <article><span>03</span><h2>Choose the next move</h2><p>Ask Kobi what is blocked, what is at risk and what deserves attention next.</p></article>
      </section>
    </main>
  );
}
