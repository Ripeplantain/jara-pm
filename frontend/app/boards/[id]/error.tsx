"use client";

import { useReportedError } from "@/components/analytics/use-reported-error";

export default function BoardError({ error, reset }: { error: Error; reset: () => void }) {
  useReportedError(error, "boards/[id]");
  return (
    <main className="simple-state">
      <h1>Couldn’t load this board</h1>
      <p role="alert">Something got in the way. Try again.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
