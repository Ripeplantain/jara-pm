import type { Metadata } from "next";
import { NotesIndex } from "@/components/notes/notes-index";
import { AppShell } from "@/components/shell/app-shell";
import { listNotes } from "@/lib/api/server";
import { loadShell } from "@/lib/page-data";

export const metadata: Metadata = { title: "Notes · Kobi" };
export const dynamic = "force-dynamic";

export default async function NotesPage() {
  const shell = await loadShell();
  const notes = shell.active ? await listNotes(shell.token, shell.active.id) : [];

  return (
    <AppShell {...shell}>
      <main id="main-content" className="page">
        <div className="page-heading">
          <div>
            <div className="eyebrow">{shell.active?.name ?? "Kobi"}</div>
            <h1>Notes</h1>
            <p>
              Pages for everything that is not a card: meeting notes, specs, research and plans.
              A page can be shared with the workspace or kept private to you.
            </p>
          </div>
        </div>
        {shell.active ? (
          <NotesIndex
            workspaceId={shell.active.id}
            role={shell.active.my_role}
            initial={notes}
            meId={shell.user.id}
          />
        ) : (
          <p className="muted">Create a workspace to start writing.</p>
        )}
      </main>
    </AppShell>
  );
}
