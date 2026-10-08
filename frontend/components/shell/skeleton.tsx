/**
 * Loading placeholders. Shaped like the content that replaces them so the page does not jump,
 * and announced once as a status rather than as a stream of "loading" for each block.
 */
export function Skeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="skeleton-block" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton-row" aria-hidden="true" />
      ))}
    </div>
  );
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
