import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { ActivityFeed } from "@/components/work/activity-feed";
import { backendFetch } from "@/lib/api/client";
import { getOverview } from "@/lib/api/server";
import { loadShell } from "@/lib/page-data";
import type { Activity } from "@/lib/types/activity";

export const metadata: Metadata = { title: "Activity · Kobi" };
export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const shell = await loadShell();
  if (!shell.active) {
    return (
      <AppShell {...shell}>
        <main id="main-content" className="page">
          <h1>No workspace</h1>
        </main>
      </AppShell>
    );
  }

  const [entries, overview] = await Promise.all([
    backendFetch<Activity[]>(`/api/workspaces/${shell.active.id}/activity?limit=50`, {
      token: shell.token,
    }),
    getOverview(shell.token, shell.active.id),
  ]);

  return (
    <AppShell {...shell}>
      <main id="main-content" className="page">
        <div className="page-heading">
          <div>
            <div className="eyebrow">{shell.active.name}</div>
            <h1>Activity</h1>
            <p>Everything that has happened here, newest first. Changes made by the assistant
              appear the same way, credited to whoever asked for them.</p>
          </div>
        </div>
        <ActivityFeed
          workspaceId={shell.active.id}
          initial={entries}
          boards={overview.boards}
          members={shell.active.members}
        />
      </main>
    </AppShell>
  );
}
