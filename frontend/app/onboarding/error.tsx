"use client";

import { useReportedError } from "@/components/analytics/use-reported-error";

export default function OnboardingError({ error, reset }: { error: Error; reset: () => void }) {
  useReportedError(error, "onboarding");
  return (
    <main className="simple-state">
      <h1>Couldn’t prepare onboarding</h1>
      <p role="alert">Your account is safe. Try loading setup again.</p>
      <button type="button" onClick={reset}>Try again</button>
    </main>
  );
}
