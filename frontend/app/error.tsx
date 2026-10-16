"use client";

import { useReportedError } from "@/components/analytics/use-reported-error";

export default function RootError({ error, reset }: { error: Error; reset: () => void }) {
  useReportedError(error, "root");
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
