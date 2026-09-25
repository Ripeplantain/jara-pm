import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { BoardView } from "@/components/board/board-view";
import { getBoard } from "@/lib/api/boards";
import { ApiError } from "@/lib/api/client";
import { getAccessToken, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/boards/[id]">): Promise<Metadata> {
  const { id } = await params;
  const token = await getAccessToken();
  const boardId = Number(id);
  if (!token || !Number.isInteger(boardId) || boardId < 1) return { title: "Board" };
  try {
    return { title: (await getBoard(token, boardId)).title };
  } catch {
    return { title: "Board" };
  }
}

export default async function BoardPage({ params }: PageProps<"/boards/[id]">) {
  const { id } = await params;
  const boardId = Number(id);
  if (!Number.isInteger(boardId) || boardId < 1) notFound();

  const user = await requireUser();
  const token = await getAccessToken();
  if (!token) redirect("/signin");
  let board;
  try {
    board = await getBoard(token, boardId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    if (err instanceof ApiError && err.status === 401) redirect("/signout");
    throw err;
  }

  return (
    <>
      <AppHeader email={user.email} context={board.title} />
      <main id="main-content" className="board-page">
        <BoardView initial={board} />
      </main>
    </>
  );
}
