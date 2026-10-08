import type { Metadata } from "next";
import { MembersView } from "@/components/members/members-view";
import { AppShell } from "@/components/shell/app-shell";
import { backendFetch } from "@/lib/api/client";
import { loadShell } from "@/lib/page-data";
import type { Invite } from "@/lib/types/workspace";

export const metadata: Metadata = { title: "Members · Kobi" };
export const dynamic = "force-dynamic";

export default async function MembersPage() {
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

  // Only admins may list invitations; for everyone else the tab simply has no pending section.
  const invites =
    shell.active.my_role === "admin" || shell.active.my_role === "owner"
      ? await backendFetch<Invite[]>(`/api/workspaces/${shell.active.id}/invites`, {
          token: shell.token,
        }).catch(() => [])
      : [];

  return (
    <AppShell {...shell}>
      <main id="main-content" className="page">
        <MembersView
          workspace={shell.active}
          members={shell.active.members}
          invites={invites}
          me={shell.user}
        />
      </main>
    </AppShell>
  );
}
