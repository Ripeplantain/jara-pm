import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { OnboardingView } from "@/components/onboarding/onboarding-view";
import { loadShell } from "@/lib/page-data";

export const metadata: Metadata = { title: "Set up Kobi" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const shell = await loadShell();
  return (
    <AppShell {...shell}>
      <main id="main-content" className="page onboarding-page">
        <OnboardingView />
      </main>
    </AppShell>
  );
}
