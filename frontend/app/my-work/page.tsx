import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { MyWorkList } from "@/components/work/my-work-list";
import { myCards } from "@/lib/api/server";
import { loadShell } from "@/lib/page-data";

export const metadata: Metadata = { title: "My work · Kobi" };
export const dynamic = "force-dynamic";

export default async function MyWorkPage() {
  const shell = await loadShell();
  const cards = shell.active ? await myCards(shell.token, shell.active.id) : [];

  return (
    <AppShell {...shell}>
      <main id="main-content" className="page">
        <div className="page-heading">
          <div>
            <div className="eyebrow">{shell.active?.name ?? "Kobi"}</div>
            <h1>My work</h1>
            <p>
              Open cards assigned to you across every board here, soonest deadline first. Cards
              in a done column drop off on their own.
            </p>
          </div>
        </div>
        <MyWorkList cards={cards} meId={shell.user.id} />
      </main>
    </AppShell>
  );
}
