import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ACTIVE_WORKSPACE_COOKIE } from "@/lib/workspace";

/**
 * Remembers which workspace the user is looking at, so the next server render starts there.
 * The value is a hint only: every page re-checks it against the user's real memberships.
 */
export async function POST(req: NextRequest) {
  const { workspaceId } = (await req.json().catch(() => ({}))) as { workspaceId?: number };
  if (!Number.isInteger(workspaceId) || (workspaceId as number) < 1) {
    return NextResponse.json({ detail: "Invalid workspace" }, { status: 422 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACTIVE_WORKSPACE_COOKIE, String(workspaceId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
