import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { BoardList } from "@/components/board/board-list";
import { listBoards } from "@/lib/api/boards";
import { ApiError } from "@/lib/api/client";
import { getAccessToken, requireUser } from "@/lib/session";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Your boards · Kobi" };
export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  const token = await getAccessToken();
  if (!token) redirect("/signin");
  let boards;
  try {
    boards = await listBoards(token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/signout");
    throw err;
  }

  return (
    <>
      <AppHeader email={user.email} />
      <main id="main-content" className="dashboard-page">
        <section className="dashboard-hero" aria-labelledby="dashboard-title">
          <div>
            <div className="eyebrow">Workspace overview</div>
            <h1 id="dashboard-title">Your boards</h1>
            <p>Keep your roadmap, launches, and daily work moving with one calm, focused workspace.</p>
          </div>
          <div className="hero-metric" aria-label={`${boards.length} boards in your workspace`}>
            <strong>{boards.length}</strong>
            <span>{boards.length === 1 ? "active board" : "active boards"}</span>
          </div>
        </section>
        <BoardList boards={boards} />
      </main>
    </>
  );
}
