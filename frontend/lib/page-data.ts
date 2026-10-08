import "server-only";
import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api/client";
import { listWorkspaces, unreadCount } from "@/lib/api/server";
import { getAccessToken, requireUser } from "@/lib/session";
import type { User } from "@/lib/types/auth";
import type { Workspace } from "@/lib/types/workspace";
import { resolveActiveWorkspace } from "@/lib/workspace";

export interface ShellData {
  token: string;
  user: User;
  workspaces: Workspace[];
  active: Workspace | null;
  unread: number;
}

/**
 * Everything the app shell needs, fetched once per page.
 *
 * Every authenticated page starts here: it verifies the session, loads the workspaces the user
 * is actually in, and resolves which one is active. A 401 from the backend means the token is
 * dead, so the user is sent to sign out rather than shown a broken page.
 */
export async function loadShell(): Promise<ShellData> {
  const user = await requireUser();
  const token = await getAccessToken();
  if (!token) redirect("/signin");
  try {
    const [workspaces, unread] = await Promise.all([
      listWorkspaces(token),
      unreadCount(token).catch(() => ({ unread: 0 })),
    ]);
    return {
      token,
      user,
      workspaces,
      active: await resolveActiveWorkspace(workspaces),
      unread: unread.unread,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/signout");
    throw err;
  }
}
