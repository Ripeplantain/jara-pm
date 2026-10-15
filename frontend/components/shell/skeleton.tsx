/**
 * Loading placeholders. Shaped like the content that replaces them so the page does not jump,
 * and announced once as a status rather than as a stream of "loading" for each block.
 */
export function Skeleton({
  rows = 3,
  label,
  className = "",
}: {
  rows?: number;
  label: string;
  className?: string;
}) {
  return (
    <div className={`skeleton-block ${className}`.trim()} role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonShape key={i} className="skeleton-row" />
      ))}
    </div>
  );
}

export function SkeletonShape({ className = "" }: { className?: string }) {
  return <span className={`skeleton-shape ${className}`.trim()} aria-hidden="true" />;
}

/** A compact shimmer for an async control whose accessible name remains on the button. */
export function SkeletonLabel({ className = "" }: { className?: string }) {
  return <SkeletonShape className={`skeleton-label ${className}`} />;
}

export function PageSkeleton({ title, rows = 4 }: { title: string; rows?: number }) {
  return (
    <main className="page" id="main-content">
      <div className="page-heading">
        <div>
          <h1>{title}</h1>
        </div>
      </div>
      <Skeleton rows={rows} label={`Loading ${title.toLowerCase()}`} />
    </main>
  );
}

function SkeletonPage({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`skeleton-page ${className}`.trim()} role="status" aria-label={label}>
      {children}
    </div>
  );
}

function SkeletonHeading({ title, copy = true }: { title: string; copy?: boolean }) {
  return (
    <div className="page-heading">
      <div>
        <SkeletonShape className="skeleton-line skeleton-line--eyebrow" />
        <h1>{title}</h1>
        {copy && (
          <>
            <SkeletonShape className="skeleton-line skeleton-line--copy" />
            <SkeletonShape className="skeleton-line skeleton-line--copy skeleton-line--copy-short" />
          </>
        )}
      </div>
    </div>
  );
}

function SkeletonAvatar() {
  return <SkeletonShape className="skeleton-avatar" />;
}

function SkeletonCardLines({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-stack">
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonShape
          key={i}
          className={`skeleton-line${i === 0 ? " skeleton-line--strong" : ""}${i === lines - 1 ? " skeleton-line--short" : ""}`}
        />
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <main id="main-content" className="dashboard-page" aria-busy="true">
      <SkeletonPage label="Loading dashboard" className="skeleton-dashboard">
        <section className="dashboard-hero">
          <div className="skeleton-stack">
            <SkeletonShape className="skeleton-line skeleton-line--eyebrow" />
            <SkeletonShape className="skeleton-line skeleton-line--hero-title" />
            <SkeletonShape className="skeleton-line skeleton-line--copy" />
            <SkeletonShape className="skeleton-line skeleton-line--copy skeleton-line--copy-short" />
          </div>
          <div className="hero-metrics">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="hero-metric">
                <SkeletonShape className="skeleton-line skeleton-line--metric" />
                <SkeletonShape className="skeleton-line skeleton-line--label" />
              </div>
            ))}
          </div>
        </section>

        <section className="dashboard-grid" aria-label="Workspace briefing">
          <article className="briefing-card">
            <SkeletonShape className="skeleton-line skeleton-line--label" />
            <SkeletonShape className="skeleton-line skeleton-line--briefing-title" />
            <SkeletonShape className="skeleton-line skeleton-line--copy" />
            <SkeletonShape className="skeleton-line skeleton-line--action" />
          </article>
          <div className="briefing-side">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="briefing-stat">
                <SkeletonShape className="skeleton-line skeleton-line--metric" />
                <SkeletonShape className="skeleton-line skeleton-line--label" />
              </div>
            ))}
          </div>
        </section>

        <section className="board-create-panel">
          <div className="create-copy skeleton-stack">
            <SkeletonShape className="skeleton-line skeleton-line--strong" />
            <SkeletonShape className="skeleton-line skeleton-line--copy skeleton-line--copy-short" />
          </div>
          <SkeletonShape className="skeleton-input" />
        </section>

        <section>
          <div className="section-heading">
            <SkeletonShape className="skeleton-line skeleton-line--section-title" />
            <SkeletonShape className="skeleton-input skeleton-input--search" />
          </div>
          <div className="board-groups">
            <div className="board-group">
              <div className="board-group-heading">
                <SkeletonShape className="skeleton-line skeleton-line--label" />
                <SkeletonShape className="skeleton-count" />
              </div>
              <ul className="board-list">
                {Array.from({ length: 3 }, (_, i) => (
                  <li key={i} className="board-card">
                    <SkeletonCardLines lines={4} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="recent-activity">
          <div className="section-heading">
            <SkeletonShape className="skeleton-line skeleton-line--section-title" />
            <SkeletonShape className="skeleton-line skeleton-line--action" />
          </div>
          <div className="activity-list skeleton-list">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skeleton-activity-row">
                <SkeletonShape className="skeleton-line skeleton-line--activity" />
              </div>
            ))}
          </div>
        </section>
      </SkeletonPage>
    </main>
  );
}

export function BoardSkeleton() {
  return (
    <main id="main-content" className="board-page" aria-busy="true">
      <div className="board">
        <SkeletonPage label="Loading board" className="skeleton-board">
          <div className="board-heading">
            <div className="board-heading-main skeleton-stack">
              <SkeletonShape className="skeleton-line skeleton-line--back" />
              <SkeletonShape className="skeleton-line skeleton-line--board-title" />
            </div>
            <div className="board-stats">
              {Array.from({ length: 3 }, (_, i) => <SkeletonShape key={i} className="skeleton-pill" />)}
            </div>
          </div>

          <div className="board-controls">
            <SkeletonShape className="skeleton-control-row" />
            <SkeletonShape className="skeleton-control-row" />
            <div className="board-view-options">
              <SkeletonShape className="skeleton-input skeleton-input--small" />
              <SkeletonShape className="skeleton-input skeleton-input--small" />
            </div>
          </div>

          <div className="columns skeleton-columns">
            {Array.from({ length: 3 }, (_, column) => (
              <section key={column} className="column">
                <div className="column-header">
                  <SkeletonShape className="skeleton-column-color" />
                  <SkeletonShape className="skeleton-line skeleton-line--column-title" />
                  <SkeletonShape className="skeleton-count" />
                </div>
                <div className="cards">
                  {Array.from({ length: column === 1 ? 3 : 2 }, (_, card) => (
                    <div key={card} className="card skeleton-card">
                      <SkeletonShape className="skeleton-line skeleton-line--card-title" />
                      <SkeletonShape className="skeleton-line skeleton-line--card-meta" />
                      {card === 0 && <SkeletonShape className="skeleton-line skeleton-line--card-meta skeleton-line--short" />}
                    </div>
                  ))}
                </div>
                <SkeletonShape className="skeleton-add-form" />
              </section>
            ))}
          </div>

          <div className="ai-panel skeleton-ai-panel">
            <div className="ai-header">
              <SkeletonShape className="skeleton-ai-icon" />
              <div className="skeleton-stack">
                <SkeletonShape className="skeleton-line skeleton-line--strong" />
                <SkeletonShape className="skeleton-line skeleton-line--label" />
              </div>
            </div>
            <SkeletonShape className="skeleton-ai-log" />
            <SkeletonShape className="skeleton-ai-form" />
          </div>
        </SkeletonPage>
      </div>
    </main>
  );
}

export function ActivitySkeleton() {
  return (
    <main id="main-content" className="page" aria-busy="true">
      <SkeletonPage label="Loading activity" className="skeleton-standard-page">
        <SkeletonHeading title="Activity" />
        <div className="filter-bar skeleton-filter-bar">
          <SkeletonShape className="skeleton-input skeleton-input--filter" />
          <SkeletonShape className="skeleton-input skeleton-input--filter" />
        </div>
        <div className="activity-feed skeleton-list">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="activity-feed-item-skeleton">
              <SkeletonAvatar />
              <SkeletonCardLines lines={2} />
            </div>
          ))}
        </div>
      </SkeletonPage>
    </main>
  );
}

export function MembersSkeleton() {
  return (
    <main id="main-content" className="page" aria-busy="true">
      <SkeletonPage label="Loading members" className="skeleton-standard-page">
        <SkeletonHeading title="Members" copy={false} />
        <div className="invite-form skeleton-invite-form">
          <SkeletonShape className="skeleton-field" />
          <SkeletonShape className="skeleton-field skeleton-field--short" />
          <SkeletonShape className="skeleton-button" />
        </div>
        <table className="member-table skeleton-table">
          <tbody>
            {Array.from({ length: 5 }, (_, i) => (
              <tr key={i}>
                <td><div className="member-cell"><SkeletonAvatar /><SkeletonCardLines lines={2} /></div></td>
                <td><SkeletonShape className="skeleton-pill skeleton-pill--role" /></td>
                <td><SkeletonShape className="skeleton-button skeleton-button--small" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <section className="pending-invites">
          <SkeletonShape className="skeleton-line skeleton-line--section-title" />
          <SkeletonShape className="skeleton-line skeleton-line--copy" />
          <SkeletonShape className="skeleton-invite-row" />
          <SkeletonShape className="skeleton-invite-row" />
        </section>
      </SkeletonPage>
    </main>
  );
}

export function MyWorkSkeleton() {
  return (
    <main id="main-content" className="page" aria-busy="true">
      <SkeletonPage label="Loading my work" className="skeleton-standard-page">
        <SkeletonHeading title="My work" />
        {Array.from({ length: 2 }, (_, group) => (
          <section key={group} className="work-group">
            <div className="skeleton-work-heading">
              <SkeletonShape className="skeleton-line skeleton-line--section-title" />
              <SkeletonShape className="skeleton-count" />
            </div>
            <ul className="work-list">
              {Array.from({ length: 2 }, (_, card) => (
                <li key={card} className="work-card">
                  <div className="work-card-main"><SkeletonCardLines lines={4} /></div>
                  <SkeletonShape className="skeleton-button skeleton-button--small" />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </SkeletonPage>
    </main>
  );
}

export function SettingsSkeleton() {
  return (
    <main id="main-content" className="page settings-page" aria-busy="true">
      <SkeletonPage label="Loading settings" className="skeleton-standard-page">
        <SkeletonHeading title="Settings" copy={false} />
        {Array.from({ length: 3 }, (_, card) => (
          <section key={card} className="settings-card skeleton-settings-card">
            <SkeletonShape className="skeleton-line skeleton-line--section-title" />
            <SkeletonShape className="skeleton-line skeleton-line--copy" />
            {Array.from({ length: card === 1 ? 2 : 1 }, (_, field) => (
              <SkeletonShape key={field} className="skeleton-field" />
            ))}
            <SkeletonShape className="skeleton-button" />
          </section>
        ))}
      </SkeletonPage>
    </main>
  );
}

export function InsightsSkeleton() {
  return (
    <main id="main-content" className="page insights-page" aria-busy="true">
      <SkeletonPage label="Loading insights" className="skeleton-standard-page">
        <SkeletonHeading title="Insights" copy={false} />
        <ul className="stat-row skeleton-stat-row">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="stat-tile"><SkeletonCardLines lines={2} /></li>
          ))}
        </ul>
        {Array.from({ length: 3 }, (_, card) => (
          <section key={card} className="insight-card skeleton-insight-card">
            <SkeletonShape className="skeleton-line skeleton-line--section-title" />
            <SkeletonShape className="skeleton-line skeleton-line--copy" />
            <SkeletonShape className={`skeleton-chart skeleton-chart--${card === 1 ? "columns" : "bars"}`} />
            <div className="skeleton-chart-table">
              {Array.from({ length: 3 }, (_, row) => <SkeletonShape key={row} className="skeleton-table-row" />)}
            </div>
          </section>
        ))}
      </SkeletonPage>
    </main>
  );
}

export function OnboardingSkeleton() {
  return (
    <main id="main-content" className="page onboarding-page" aria-busy="true">
      <SkeletonPage label="Preparing setup" className="skeleton-onboarding">
        <div className="onboarding-card">
          <SkeletonShape className="skeleton-line skeleton-line--eyebrow" />
          <SkeletonShape className="skeleton-line skeleton-line--onboarding-title" />
          <SkeletonShape className="skeleton-line skeleton-line--copy" />
          <SkeletonShape className="skeleton-line skeleton-line--copy skeleton-line--copy-short" />
          <div className="onboarding-grid">
            <SkeletonShape className="skeleton-field" />
            <SkeletonShape className="skeleton-field" />
          </div>
          <SkeletonShape className="skeleton-textarea" />
          <div className="template-options">
            {Array.from({ length: 3 }, (_, i) => <SkeletonShape key={i} className="skeleton-template-option" />)}
          </div>
          <div className="onboarding-grid">
            <SkeletonShape className="skeleton-field" />
            <SkeletonShape className="skeleton-field" />
          </div>
          <SkeletonShape className="skeleton-textarea skeleton-textarea--short" />
          <div className="onboarding-actions">
            <SkeletonShape className="skeleton-button skeleton-button--wide" />
            <SkeletonShape className="skeleton-button skeleton-button--wide" />
          </div>
        </div>
      </SkeletonPage>
    </main>
  );
}
