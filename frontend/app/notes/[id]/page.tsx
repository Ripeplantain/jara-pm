import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NotePage } from "@/components/notes/note-page";
import { AppShell } from "@/components/shell/app-shell";
import { ApiError } from "@/lib/api/client";
import { getNote, listNotes } from "@/lib/api/server";
import { loadShell } from "@/lib/page-data";
import { noteTitle } from "@/lib/types/note";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Page · Kobi" };

export default async function NoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const noteId = Number(id);
  if (!Number.isInteger(noteId)) notFound();

  const shell = await loadShell();
  let note;
  try {
    note = await getNote(shell.token, noteId);
  } catch (err) {
    // A private page belonging to somebody else is a 404 by design, not a 403.
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  // The page's own workspace, not the active one: a link can be followed from anywhere.
  const pages = await listNotes(shell.token, note.workspace_id);

  return (
    <AppShell {...shell} context={noteTitle(note)}>
      <main id="main-content" className="page note-page-main">
        <NotePage
          note={note}
          role={shell.active?.my_role ?? "viewer"}
          meId={shell.user.id}
          parent={pages.find((page) => page.id === note.parent_id) ?? null}
          subpages={pages.filter((page) => page.parent_id === note.id)}
        />
      </main>
    </AppShell>
  );
}
