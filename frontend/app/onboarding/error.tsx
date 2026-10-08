"use client";

export default function OnboardingError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="simple-state">
      <h1>Couldn’t prepare onboarding</h1>
      <p role="alert">Your account is safe. Try loading setup again.</p>
      <button type="button" onClick={reset}>Try again</button>
    </main>
  );
}
