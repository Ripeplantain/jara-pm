"use client";

export default function SettingsError({ reset }: { error: Error; reset: () => void }) {
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
