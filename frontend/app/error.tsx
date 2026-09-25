"use client";

export default function RootError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="simple-state">
      <h1>Something went wrong</h1>
      <p role="alert">We couldn’t load this view. Try again.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
