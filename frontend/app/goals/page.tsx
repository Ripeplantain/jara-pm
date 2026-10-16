import type { Metadata } from "next";
import { GoalsView } from "@/components/goals/goals-view";
import { AppShell } from "@/components/shell/app-shell";
import { listGoals } from "@/lib/api/server";
import { loadShell } from "@/lib/page-data";

export const metadata: Metadata = { title: "Goals · Kobi" };
export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const shell = await loadShell();
  const goals = shell.active ? await listGoals(shell.token, shell.active.id) : [];

  return (
    <AppShell {...shell}>
      <main id="main-content" className="page">
        <div className="page-heading">
          <div>
            <div className="eyebrow">{shell.active?.name ?? "Kobi"}</div>
            <h1>Goals</h1>
            <p>
              What the boards are for. A goal&rsquo;s progress is read from the cards it points
              at, so it moves when the work moves rather than when somebody updates a number.
            </p>
          </div>
        </div>
        {shell.active ? (
          <GoalsView
            workspaceId={shell.active.id}
            role={shell.active.my_role}
            initial={goals}
          />
        ) : (
          <p className="muted">Create a workspace to set goals.</p>
        )}
      </main>
    </AppShell>
  );
}
