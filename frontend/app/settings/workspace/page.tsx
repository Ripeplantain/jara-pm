import type { Metadata } from "next";
import { WorkspaceSettings } from "@/components/settings/workspace-settings";
import { AppShell } from "@/components/shell/app-shell";
import { listLabels } from "@/lib/api/server";
import { loadShell } from "@/lib/page-data";

export const metadata: Metadata = { title: "Workspace settings · Kobi" };
export const dynamic = "force-dynamic";

export default async function WorkspaceSettingsPage() {
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
  const labels = await listLabels(shell.token, shell.active.id);

  return (
    <AppShell {...shell}>
      <main id="main-content" className="page settings-page">
        <div className="page-heading">
          <div>
            <div className="eyebrow">Settings</div>
            <h1>{shell.active.name}</h1>
          </div>
        </div>
        <WorkspaceSettings
          workspace={shell.active}
          labels={labels}
          workspaceCount={shell.workspaces.length}
        />
      </main>
    </AppShell>
  );
}
