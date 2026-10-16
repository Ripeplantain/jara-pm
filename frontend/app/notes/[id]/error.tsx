"use client";

import Link from "next/link";
import { useReportedError } from "@/components/analytics/use-reported-error";

export default function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  useReportedError(error, "notes/[id]");
  return (
    <main className="simple-state">
      <h1>Couldn’t open this page</h1>
      <p role="alert">
        It may have been deleted, or it may be private to someone else. Try again, or go back to
        your notes.
      </p>
      <button type="button" onClick={reset}>
        Try again
      </button>
      <p>
        <Link href="/notes">Back to notes</Link>
      </p>
    </main>
  );
}
