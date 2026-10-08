import "server-only";
import { cookies } from "next/headers";
import type { Workspace } from "@/lib/types/workspace";

/**
 * The active workspace.
 *
 * Kept in a cookie so Server Components can read it during the first render instead of waiting
 * for the client to say which one it wants. The cookie is only a hint: the value is always
 * checked against the workspaces the backend says the user is in, so a stale or forged cookie
 * falls back to their first workspace rather than leaking anything.
 */
export const ACTIVE_WORKSPACE_COOKIE = "kobi.workspace";

export async function resolveActiveWorkspace(workspaces: Workspace[]): Promise<Workspace | null> {
  if (workspaces.length === 0) return null;
  const jar = await cookies();
  const wanted = Number(jar.get(ACTIVE_WORKSPACE_COOKIE)?.value);
  return workspaces.find((w) => w.id === wanted) ?? workspaces[0];
}
