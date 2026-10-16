"use client";

import { useReportedError } from "@/components/analytics/use-reported-error";

export default function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  useReportedError(error, "habits");
  return (
    <main className="simple-state">
      <h1>Couldn’t load your habits</h1>
      <p role="alert">Something got in the way. Try again, or reload the page.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
