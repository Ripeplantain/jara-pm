import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BoardView } from "@/components/board/board-view";
import { AppShell } from "@/components/shell/app-shell";
import { backendFetch, ApiError } from "@/lib/api/client";
import { getBoard, listLabels } from "@/lib/api/server";
import { loadShell } from "@/lib/page-data";
import { getAccessToken } from "@/lib/session";
import type { Sprint } from "@/lib/types/sprint";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/boards/[id]">): Promise<Metadata> {
  const { id } = await params;
  const token = await getAccessToken();
  const boardId = Number(id);
  if (!token || !Number.isInteger(boardId) || boardId < 1) return { title: "Board" };
  try {
    return { title: `${(await getBoard(token, boardId)).title} · Kobi` };
  } catch {
    return { title: "Board" };
  }
}

export default async function BoardPage({ params }: PageProps<"/boards/[id]">) {
  const { id } = await params;
  const boardId = Number(id);
  if (!Number.isInteger(boardId) || boardId < 1) notFound();

  const shell = await loadShell();
  let board;
  try {
    board = await getBoard(shell.token, boardId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  // The board may live in a workspace other than the active one (a link from a notification,
  // say), so member and label lists come from the board's own workspace, not the active one.
  const workspace =
    shell.workspaces.find((w) => w.id === board.workspace_id) ?? shell.active ?? null;
  if (!workspace) notFound();

  const [labels, sprints] = await Promise.all([
    listLabels(shell.token, board.workspace_id).catch(() => []),
    backendFetch<Sprint[]>(`/api/boards/${boardId}/sprints`, { token: shell.token }).catch(() => []),
  ]);

  return (
    <AppShell {...shell} context={board.title}>
      <main id="main-content" className="board-page">
        <BoardView
          initial={board}
          members={workspace.members}
          labels={labels}
          sprints={sprints}
          role={workspace.my_role}
          meId={shell.user.id}
        />
      </main>
    </AppShell>
  );
}
