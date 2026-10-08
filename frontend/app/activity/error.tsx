"use client";

export default function RouteError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="simple-state">
      <h1>Couldn’t load Activity</h1>
      <p role="alert">Something got in the way. Try again, or reload the page.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
