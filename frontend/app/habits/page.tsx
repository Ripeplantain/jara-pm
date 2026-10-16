import type { Metadata } from "next";
import { HabitsView } from "@/components/habits/habits-view";
import { AppShell } from "@/components/shell/app-shell";
import { listHabits } from "@/lib/api/server";
import { loadShell } from "@/lib/page-data";

export const metadata: Metadata = { title: "Habits · Kobi" };
export const dynamic = "force-dynamic";

export default async function HabitsPage() {
  const shell = await loadShell();
  const habits = shell.active ? await listHabits(shell.token, shell.active.id) : [];

  return (
    <AppShell {...shell}>
      <main id="main-content" className="page">
        <div className="page-heading">
          <div>
            <div className="eyebrow">{shell.active?.name ?? "Kobi"}</div>
            <h1>Habits</h1>
            <p>
              The repeating work a card cannot hold. Habits are private to you: nobody else in
              the workspace can see them, whatever their role.
            </p>
          </div>
        </div>
        {shell.active ? (
          <HabitsView workspaceId={shell.active.id} initial={habits} />
        ) : (
          <p className="muted">Create a workspace to start tracking habits.</p>
        )}
      </main>
    </AppShell>
  );
}
