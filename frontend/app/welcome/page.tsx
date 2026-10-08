import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Product work, with a clear next move",
  description: "Kobi brings product teams, planning and an AI copilot into one calm workspace.",
};

export default function WelcomePage() {
  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Marketing navigation">
        <Link className="brand-link" href="/welcome">
          <span className="brand-mark" aria-hidden="true">K</span>
          <span>Kobi</span>
        </Link>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link className="landing-nav-cta" href="/signup">Join the beta</Link>
        </div>
      </nav>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-copy">
          <p className="eyebrow">Product work, made lighter</p>
          <h1 id="landing-title">Turn scattered ideas into the next clear move.</h1>
          <p className="landing-lede">
            Kobi gives small product teams a calm shared workspace for decisions, delivery and the
            context behind both—with an AI copilot that helps you move the work forward.
          </p>
          <div className="landing-actions">
            <Link className="landing-primary" href="/signup">Join the invite-only beta <span aria-hidden="true">↗</span></Link>
            <Link className="landing-secondary" href="/signin">Sign in</Link>
          </div>
          <p className="landing-note">Built for product teams of 2–10 people. No credit card required.</p>
        </div>
        <div className="landing-preview" aria-label="Kobi workspace preview">
          <div className="preview-window-bar"><span /><span /><span /><b>Product workspace</b></div>
          <div className="preview-content">
            <div className="preview-sidebar"><strong>Kobi</strong><span>Boards</span><span>My work</span><span>Activity</span><span>Ask Kobi</span></div>
            <div className="preview-board"><small>THIS WEEK · PRODUCT</small><h2>Make checkout feel effortless</h2><div className="preview-columns"><div><b>To do</b><i>Clarify pricing copy</i><i>Map the happy path</i></div><div><b>In progress</b><i>Run user interviews</i></div><div><b>Done</b><i>Define activation metric</i></div></div></div>
          </div>
        </div>
      </section>

      <section className="landing-points" aria-label="Kobi capabilities">
        <article><span>01</span><h2>See the work</h2><p>Boards, sprints, ownership and signals that make the state of your product legible.</p></article>
        <article><span>02</span><h2>Make better calls</h2><p>Ask Kobi what is blocked, what is at risk and what deserves attention next.</p></article>
        <article><span>03</span><h2>Keep momentum</h2><p>Turn decisions into small, trackable steps with the whole team in the loop.</p></article>
      </section>
    </main>
  );
}
