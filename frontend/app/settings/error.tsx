"use client";

import { useReportedError } from "@/components/analytics/use-reported-error";

export default function SettingsError({ error, reset }: { error: Error; reset: () => void }) {
  useReportedError(error, "settings");
  return (
    <main className="simple-state">
      <h1>Couldn’t load settings</h1>
      <p role="alert">Something got in the way. Try again.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
